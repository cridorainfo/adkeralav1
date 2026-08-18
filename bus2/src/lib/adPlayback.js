/** True when an ad entry has a local or remote media reference and hasn't run out of budget.
 * Exhaustion is decomposed into its three independent reasons (money-budget spend, money-budget
 * play quota, weekly-view hard cap) and re-evaluated against `now` rather than trusting the flat
 * `ad.exhausted` boolean the cloud last stamped — this matters specifically for the weekly cap:
 * a locally-tracked week rollover (see effectiveWeeklyState below) can un-exhaust an ad the
 * instant the device's own clock crosses into a new week, fully offline, without waiting for a
 * cloud round-trip to clear a stale `exhausted: true`. House ads carry none of these fields, so
 * they always fall through to "playable" here — the natural fallback once every paid ad is
 * exhausted, with no special-case branching at any call site. */
export function adHasPlayableMedia(ad, now = Date.now()) {
  if (!ad) return false;
  if (ad.exhaustedBySpend) return false;
  if (Number.isFinite(ad.playsRemaining) && ad.playsRemaining <= 0) return false;
  const weekly = effectiveWeeklyState(ad, now);
  if (weekly.weeklyPlaysRemaining != null && weekly.weeklyPlaysRemaining <= 0) return false;
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
export function nextPlayableAdIndex(ads = [], startIndex = 0, now = Date.now()) {
  if (!ads.length) return -1;
  const start = ((startIndex % ads.length) + ads.length) % ads.length;
  for (let i = 0; i < ads.length; i++) {
    const idx = (start + i) % ads.length;
    if (adHasPlayableMedia(ads[idx], now)) return idx;
  }
  return -1;
}

export function filterPlayableAds(ads = [], now = Date.now()) {
  return ads.filter((ad) => adHasPlayableMedia(ad, now));
}

const WEEK_WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_TIMEZONE = 'Asia/Kolkata';

/** Milliseconds elapsed since the start of the current Mon–Sun local week containing `now` —
 * device-side mirror of cloud/pricing.js's msIntoWeek (same Asia/Kolkata local-calendar week,
 * duplicated here rather than shared since the on-device app and cloud backend are separate
 * bundles — see that file's own doc comment for the same reasoning). */
function msIntoWeek(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WEEK_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const dayIndex = WEEK_WEEKDAY_INDEX[get('weekday')] ?? 0;
  // Intl only reports whole seconds, but `now` (the value weekStartMs subtracts this from) has
  // millisecond precision — without adding `now`'s own millisecond-of-second back in here,
  // weekStartMs(now) would carry a residual equal to `now % 1000` and drift by a few ms on every
  // call, making it useless as a stable, comparable "which week is this" identifier (which is
  // exactly what effectiveWeeklyState/reconcileAdsWeeklyFields need it to be — two calls a moment
  // apart, same week, must produce the identical value). Milliseconds don't shift across
  // timezones, so `now % 1000` is safe to add directly regardless of timeZone.
  const msIntoDay = ((Number(get('hour')) * 60 + Number(get('minute'))) * 60 + Number(get('second'))) * 1000
    + (((now % 1000) + 1000) % 1000);
  return dayIndex * 24 * 60 * 60 * 1000 + msIntoDay;
}

/** Start-of-week timestamp (ms) for the Mon–Sun local week containing `now` — the device's own
 * clock is the sole authority here (deliberately not something read from any synced state), so
 * this keeps working correctly for as long as the bus is offline. Mirrors cloud/pricing.js's
 * weekStartMs (same calendar-week definition), the shared building block for effectiveWeeklyState
 * below: local decrementing, playability checks, and cloud-sync reconciliation all compute "what
 * week is it" through this one function so none of them can ever disagree with each other. */
export function weekStartMs(now = Date.now()) {
  return now - msIntoWeek(now);
}

/** Fraction (0..1) of the current Mon–Sun local week elapsed as of `now`. No longer used for ad
 * pacing (see effectiveWeeklyState's doc comment for why the hard cap replaced the old soft
 * "spread evenly across the week" throttle this originally existed for) — kept as a small, still
 * generically useful building block (e.g. a "how far into the week are we" admin/debug display). */
export function weekElapsedFraction(now = Date.now()) {
  return Math.min(1, Math.max(0, msIntoWeek(now) / WEEK_MS));
}

/** Given an ad carrying weekly-cap fields — `weeklyPerBusTarget`/`weeklyViewsUsed`/
 * `weeklyPlaysRemaining`/`weeklyWeekStartMs` (cloud-stamped by cloud/server.js stampExhaustion and
 * then locally decremented on every play — see decrementAdQuota below) — returns the state that's
 * actually valid for `now`'s local week, resetting to a fresh full allowance if the ad's stored
 * `weeklyWeekStartMs` belongs to a week other than the one `now` falls in. This is the single
 * place "has the week rolled over" is decided, reused by playability checks (adHasPlayableMedia),
 * the local per-play decrement (decrementAdQuota), and cloud-sync reconciliation
 * (server/cloudSync.js reconcileAdsWeeklyFields) — so a bus that's been offline across a Sunday
 * night gets a correct fresh weekly allowance purely from its own clock, without needing to reach
 * the cloud first. Never mutates `ad`; callers persist whatever they do with the result themselves.
 *
 * Replaces the old isAdOnWeeklyPace/nextPacedAdIndex soft "spread evenly across the week" pacing:
 * that mechanism only ever throttled ads that were *under* their cap from running ahead of a
 * smooth drip-feed, and relied on a `weeklyViewsUsed` value that went stale (frozen) the moment
 * the bus went offline while `weekElapsedFraction` kept climbing off the device's own clock — so
 * the longer a bus stayed offline, the *more* permissive it became, the opposite of a cap. A hard
 * cap, tracked locally exactly like the money-budget `playsRemaining` mechanism already is, is
 * both simpler and closes that offline drift instead of just bounding it. */
export function effectiveWeeklyState(ad, now = Date.now()) {
  const weeklyPerBusTarget = Number(ad?.weeklyPerBusTarget);
  if (!Number.isFinite(weeklyPerBusTarget) || weeklyPerBusTarget <= 0) {
    return { weeklyPerBusTarget: null, weeklyViewsUsed: null, weeklyPlaysRemaining: null, weeklyWeekStartMs: null };
  }
  const currentWeekStart = weekStartMs(now);
  const storedWeekStart = Number(ad?.weeklyWeekStartMs);
  if (storedWeekStart === currentWeekStart) {
    const weeklyViewsUsed = Number(ad?.weeklyViewsUsed) || 0;
    const weeklyPlaysRemaining = Number.isFinite(Number(ad?.weeklyPlaysRemaining))
      ? Number(ad.weeklyPlaysRemaining)
      : Math.max(0, weeklyPerBusTarget - weeklyViewsUsed);
    return { weeklyPerBusTarget, weeklyViewsUsed, weeklyPlaysRemaining, weeklyWeekStartMs: currentWeekStart };
  }
  // Stored counters belong to a different (older, per the device's own clock — never a future
  // week, since currentWeekStart only ever advances) week — fresh allowance, ignoring whatever
  // was persisted for that old week.
  return {
    weeklyPerBusTarget,
    weeklyViewsUsed: 0,
    weeklyPlaysRemaining: weeklyPerBusTarget,
    weeklyWeekStartMs: currentWeekStart,
  };
}

/** Decrements a bus's own local copy of an ad's remaining play allowance the instant a play
 * finishes, so both hard stops — the money-budget play quota (`playsRemaining`) and the weekly
 * view cap (`weeklyPlaysRemaining`, via effectiveWeeklyState so a local week rollover is applied
 * *before* decrementing) — apply immediately even fully offline, without waiting for the next
 * sync. `exhausted` is recomputed from decomposed reasons rather than OR'd onto the ad's previous
 * flag: carrying forward a stale `true` would permanently stick a weekly-capped ad exhausted even
 * after a valid local rollover reset it, since nothing else would ever clear it before the next
 * cloud sync. Self-corrects on every sync regardless — cloud/server.js stampExhaustion recomputes
 * both quotas fresh from real play counts, and server/cloudSync.js reconcileAdsWeeklyFields folds
 * that back in without regressing whatever this device already tracked locally. Fullscreen ads
 * only — same scope as the budget/quota system itself; banner/audio ads aren't budget-instrumented. */
export function decrementAdQuota(ads, adId, now = Date.now()) {
  let changed = false;
  const next = (ads ?? []).map((ad) => {
    if (ad.id !== adId) return ad;
    const patch = {};
    let touched = false;
    if (Number.isFinite(ad.playsRemaining)) {
      touched = true;
      patch.playsRemaining = Math.max(0, ad.playsRemaining - 1);
    }
    const weekly = effectiveWeeklyState(ad, now);
    if (weekly.weeklyPerBusTarget != null) {
      touched = true;
      patch.weeklyPerBusTarget = weekly.weeklyPerBusTarget;
      patch.weeklyViewsUsed = weekly.weeklyViewsUsed + 1;
      patch.weeklyPlaysRemaining = Math.max(0, weekly.weeklyPlaysRemaining - 1);
      patch.weeklyWeekStartMs = weekly.weeklyWeekStartMs;
    }
    if (!touched) return ad;
    changed = true;
    const exhausted = Boolean(ad.exhaustedBySpend)
      || (patch.playsRemaining != null && patch.playsRemaining <= 0)
      || (patch.weeklyPlaysRemaining != null && patch.weeklyPlaysRemaining <= 0);
    return { ...ad, ...patch, exhausted };
  });
  return changed ? next : ads;
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
