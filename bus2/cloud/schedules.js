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
      scheduleSavedAt,
      source: 'schedule',
    });
    // Not withMediaFiles() (cloud/fleet.js) — that helper is ads-specific (reads payload.ads/
    // bannerAds), so it wouldn't see media referenced under `items`. Compute directly instead.
    const cmd = await enqueueCommand(busId, 'UPDATE_SCHEDULE', {
      items: catalog.items,
      showFullscreenAds: catalog.showFullscreenAds,
      showBannerAds: catalog.showBannerAds,
      scheduleSavedAt: catalog.scheduleSavedAt,
      savedAt: scheduleSavedAt,
      mediaFiles: collectScheduleMediaPaths(catalog.items),
    });
    queued.push({ busId, commandId: cmd.id });
  }
  return { ok: true, queued };
}
