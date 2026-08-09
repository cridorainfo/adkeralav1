/** True when an ad entry has a local or remote media reference and hasn't run out of budget.
 * `exhausted` is stamped by the cloud (cloud/server.js stampExhaustionAndAppendHouseAds) from
 * reported plays vs the ad's amount — never set locally, and house ads never carry it — so
 * folding the check in here is enough for rotation to naturally fall back to house ads once
 * every paid ad is exhausted, with no special-case branching at any call site. */
export function adHasPlayableMedia(ad) {
  if (!ad) return false;
  if (ad.exhausted) return false;
  const url = String(ad.mediaUrl ?? '').trim();
  const file = String(ad.mediaFile ?? '').trim();
  return Boolean(url || file);
}

function stopKey(stop) {
  const en = typeof stop === 'string' ? stop : stop?.en;
  return String(en ?? '').trim().toLowerCase();
}

/** Index of a playable ad pinned to the upcoming stop (via triggerStopEn), so it can be shown
 * before the bus actually reaches that stop instead of waiting for the normal interval timer.
 * Guarded by currentStopIndex so it fires once per approach to a given stop, not every tick
 * while still approaching it — resets naturally once the bus advances past that stop. */
export function findStopTriggeredAdIndex(ads = [], upcomingStop, state = {}) {
  const key = stopKey(upcomingStop);
  if (!key) return -1;
  if ((state.lastStopAdTriggerStopIndex ?? null) === (state.currentStopIndex ?? null)) return -1;
  return ads.findIndex((ad) => adHasPlayableMedia(ad) && stopKey(ad.triggerStopEn) === key);
}

/** Next ad index with media, starting from startIndex; -1 if none. */
export function nextPlayableAdIndex(ads = [], startIndex = 0) {
  if (!ads.length) return -1;
  const start = ((startIndex % ads.length) + ads.length) % ads.length;
  for (let i = 0; i < ads.length; i++) {
    const idx = (start + i) % ads.length;
    if (adHasPlayableMedia(ads[idx])) return idx;
  }
  return -1;
}

export function filterPlayableAds(ads = []) {
  return ads.filter(adHasPlayableMedia);
}

const PACE_WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const PACE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PACE_TIMEZONE = 'Asia/Kolkata';

/** Fraction (0..1) of the current Mon–Sun local week elapsed as of `now` — mirrors
 * cloud/pricing.js's msIntoWeek/weekStartMs (same Asia/Kolkata local-calendar week, duplicated
 * here rather than shared since the on-device app and cloud backend are separate bundles). Used
 * to judge whether a weekly-paced ad's plays-so-far are tracking the week or running ahead of it. */
export function weekElapsedFraction(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACE_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const dayIndex = PACE_WEEKDAY_INDEX[get('weekday')] ?? 0;
  const msIntoDay = ((Number(get('hour')) * 60 + Number(get('minute'))) * 60 + Number(get('second'))) * 1000;
  const msIntoWeek = dayIndex * 24 * 60 * 60 * 1000 + msIntoDay;
  return Math.min(1, Math.max(0, msIntoWeek / PACE_WEEK_MS));
}

/** True when a weekly-paced ad (server-stamped `weeklyPerBusTarget`/`weeklyViewsUsed` — see
 * cloud/server.js stampExhaustion) hasn't already played more than its fair share for how far
 * into the week we are. Ads with no weekly target (house ads, or paid ads admin hasn't set one
 * for) are always "on pace" — pacing only throttles ads that specifically opted into it, same as
 * the exhausted/playQuota money-budget stamping this mirrors.
 *
 * The `+ 1` grace view keeps this from being a rigid schedule: a single early play right after a
 * fresh weekly reset (week barely started, so "expected" rounds to ~0) shouldn't make the ad wait
 * for the clock to catch up — the point is stopping it from running far ahead of pace, not
 * enforcing an exact drip-feed. */
export function isAdOnWeeklyPace(ad, now = Date.now()) {
  const target = Number(ad?.weeklyPerBusTarget);
  if (!Number.isFinite(target) || target <= 0) return true;
  const used = Number(ad?.weeklyViewsUsed) || 0;
  const expected = target * weekElapsedFraction(now);
  return used <= expected + 1;
}

/** Next ad index with media that's also on-pace for its weekly view target, starting from
 * startIndex; -1 if none qualify right now. Same rotation order as nextPlayableAdIndex, just
 * additionally skipping ads that have run ahead of their weekly share — used at every ad
 * opportunity (route mode's interval timer, entertainment mode's content-switch trigger) so a
 * paced ad's plays spread across the week instead of exhausting the moment its turn comes up. */
export function nextPacedAdIndex(ads = [], startIndex = 0, now = Date.now()) {
  if (!ads.length) return -1;
  const start = ((startIndex % ads.length) + ads.length) % ads.length;
  for (let i = 0; i < ads.length; i++) {
    const idx = (start + i) % ads.length;
    if (adHasPlayableMedia(ads[idx]) && isAdOnWeeklyPace(ads[idx], now)) return idx;
  }
  return -1;
}

/** Seconds until the next fullscreen ad may start (initial delay vs repeat interval). */
export function getFullscreenAdSchedule(state, now = Date.now()) {
  const lastEnd = state.lastAdEndedAt ?? 0;
  const intervalSec = state.adSettings?.intervalSec ?? 90;
  const initialDelaySec = state.adSettings?.initialDelaySec ?? intervalSec;
  const openedAt = state.displayOpenedAt;

  let anchor;
  let thresholdSec;

  if (openedAt != null && openedAt > 0) {
    const hasPlayedSinceOpen = lastEnd >= openedAt;
    anchor = hasPlayedSinceOpen ? lastEnd : openedAt;
    thresholdSec = hasPlayedSinceOpen ? intervalSec : initialDelaySec;
  } else if (lastEnd > 0) {
    // displayOpenedAt is display-local and often missing from db/info.txt after sync.
    anchor = lastEnd;
    thresholdSec = intervalSec;
  } else {
    anchor = 0;
    thresholdSec = initialDelaySec;
  }

  const elapsedSec = (now - anchor) / 1000;
  return {
    elapsedSec,
    thresholdSec,
    ready: elapsedSec >= thresholdSec,
  };
}
