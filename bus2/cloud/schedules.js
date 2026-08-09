import { randomUUID } from 'crypto';
import { collectScheduleMediaPaths } from './scheduleCatalog.js';
import { getSchedulesCatalog, saveSchedulesCatalog, setBusScheduleCatalog, enqueueCommand } from './store.js';

/**
 * Schedules (entertainment/tourist-bus media playlists) — deliberately mirrors
 * cloud/campaigns.js's shape (list/create/update/delete/push against a `targetBusIds` array),
 * since it's the same "author once, target a set of buses, push, device reconciles" pipeline.
 * Unlike campaigns, storage goes through getSchedulesCatalog/saveSchedulesCatalog
 * (cloud/store.js), which is properly Postgres-safe — see that file's comment on why campaigns'
 * plain loadStore()/saveStore() usage isn't a pattern worth copying.
 *
 * No budget/spend/quota concept exists for schedules (unlike ads) — "keeping track of how it
 * played" is satisfied by the bus reporting its current loop count/item index through its
 * existing telemetry push (server/cloudSync.js's buildTelemetry), not a separate play-ledger.
 */

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const SCHEDULE_TIMEZONE = 'Asia/Kolkata';

function normalizeActiveDays(value) {
  if (!Array.isArray(value)) return [];
  const set = new Set(value.map((d) => String(d).toLowerCase().slice(0, 3)).filter((d) => WEEKDAY_KEYS.includes(d)));
  // An empty selection and "every day picked" both mean "no restriction" — store as [] either
  // way so isScheduleWindowActive (and every UI reading this field) has exactly one shape to
  // check for "always active on any day".
  return set.size >= WEEKDAY_KEYS.length ? [] : [...set];
}

function normalizeDateStr(value) {
  const str = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

/**
 * A schedule's optional "when is this active" window — deliberately just two orthogonal, both-
 * optional filters (day-of-week + inclusive date range) rather than separate "days/weeks/months"
 * concepts: a date range already expresses a week, a month, a single day, or a multi-year season
 * just by how far apart start/end are, so there's no need for the admin UI or this data shape to
 * distinguish those as different things. Both empty = active every day, no expiry (the schedule's
 * original always-on behavior, so existing schedules keep working unchanged).
 *
 *   activeDays: ['sat', 'sun']       → only active on those weekdays (local Asia/Kolkata date)
 *   startDate/endDate: 'YYYY-MM-DD'  → only active within that inclusive local-date range
 *
 * Combine both for e.g. "weekends only, and only during the Dec–Jan tourist season". Mirrored
 * on-device by src/lib/scheduleWindow.js and in the admin UI by
 * cloud/web/src/lib/scheduleWindow.js (three small copies rather than a shared import, same
 * reasoning as adPlayback.js/pricing.js's week-math duplication — device app, cloud server, and
 * cloud admin web are three separate bundles).
 */
export function isScheduleWindowActive(schedule, now = Date.now()) {
  if (!schedule) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
  const weekdayKey = String(get('weekday') ?? '').toLowerCase().slice(0, 3);

  const days = schedule.activeDays;
  if (Array.isArray(days) && days.length && !days.includes(weekdayKey)) return false;
  if (schedule.startDate && isoDate < schedule.startDate) return false;
  if (schedule.endDate && isoDate > schedule.endDate) return false;
  return true;
}

export async function listSchedules() {
  const schedules = await getSchedulesCatalog();
  return Object.values(schedules).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getSchedule(id) {
  const schedules = await getSchedulesCatalog();
  const schedule = schedules[id];
  if (!schedule) return null;
  return { ...schedule, items: [...(schedule.items ?? [])] };
}

export async function createSchedule(user, body) {
  const schedules = await getSchedulesCatalog();
  const id = randomUUID();
  const schedule = {
    id,
    name: String(body.name ?? 'Untitled schedule').trim(),
    items: Array.isArray(body.items) ? body.items : [],
    targetBusIds: Array.isArray(body.targetBusIds) ? body.targetBusIds : [],
    showFullscreenAds: body.showFullscreenAds !== false,
    showBannerAds: body.showBannerAds !== false,
    activeDays: normalizeActiveDays(body.activeDays),
    startDate: normalizeDateStr(body.startDate),
    endDate: normalizeDateStr(body.endDate),
    status: body.status ?? 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveSchedulesCatalog({ ...schedules, [id]: schedule });
  return { ok: true, schedule };
}

export async function updateSchedule(id, patch) {
  const schedules = await getSchedulesCatalog();
  const schedule = schedules[id];
  if (!schedule) return { ok: false, error: 'Schedule not found' };

  if (patch.name != null) schedule.name = String(patch.name).trim();
  if (patch.items != null) schedule.items = patch.items;
  if (patch.targetBusIds != null) schedule.targetBusIds = patch.targetBusIds;
  if (patch.showFullscreenAds != null) schedule.showFullscreenAds = Boolean(patch.showFullscreenAds);
  if (patch.showBannerAds != null) schedule.showBannerAds = Boolean(patch.showBannerAds);
  if (patch.activeDays != null) schedule.activeDays = normalizeActiveDays(patch.activeDays);
  if (patch.startDate !== undefined) schedule.startDate = normalizeDateStr(patch.startDate);
  if (patch.endDate !== undefined) schedule.endDate = normalizeDateStr(patch.endDate);
  if (patch.status != null) schedule.status = patch.status;
  schedule.updatedAt = Date.now();

  await saveSchedulesCatalog({ ...schedules, [id]: schedule });
  return { ok: true, schedule };
}

export async function deleteSchedule(id) {
  const schedules = await getSchedulesCatalog();
  if (!schedules[id]) return { ok: false, error: 'Schedule not found' };
  const { [id]: _removed, ...rest } = schedules;
  await saveSchedulesCatalog(rest);
  return { ok: true, deleted: id };
}

/** Writes this schedule's content into every targeted bus's own pushed-content catalog
 * (getBusScheduleCatalog/setBusScheduleCatalog) and enqueues UPDATE_SCHEDULE so an already-
 * connected bus picks it up within seconds rather than waiting for its next full pull —
 * exact mirror of pushCampaignToBuses (cloud/campaigns.js). */
export async function pushScheduleToBuses(id, busProfiles) {
  const schedule = await getSchedule(id);
  if (!schedule) return { ok: false, error: 'Schedule not found' };

  const queued = [];
  for (const busId of schedule.targetBusIds ?? []) {
    const scheduleSavedAt = Date.now();
    const catalog = await setBusScheduleCatalog(busId, {
      items: schedule.items ?? [],
      showFullscreenAds: schedule.showFullscreenAds,
      showBannerAds: schedule.showBannerAds,
      activeDays: schedule.activeDays,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      scheduleSavedAt,
      source: 'schedule',
    });
    // Not withMediaFiles() (cloud/fleet.js) — that helper is ads-specific (reads payload.ads/
    // bannerAds), so it wouldn't see media referenced under `items`. Compute directly instead.
    const cmd = await enqueueCommand(busId, 'UPDATE_SCHEDULE', {
      items: catalog.items,
      showFullscreenAds: catalog.showFullscreenAds,
      showBannerAds: catalog.showBannerAds,
      // Pushed once and re-checked by the bus itself every tick (src/lib/scheduleWindow.js) —
      // not re-evaluated here, so a "weekend tour" schedule keeps working Saturday-to-Saturday
      // without admin needing to re-push it each week.
      activeDays: catalog.activeDays,
      startDate: catalog.startDate,
      endDate: catalog.endDate,
      scheduleSavedAt: catalog.scheduleSavedAt,
      savedAt: scheduleSavedAt,
      mediaFiles: collectScheduleMediaPaths(catalog.items),
    });
    queued.push({ busId, commandId: cmd.id });
  }
  return { ok: true, queued };
}
