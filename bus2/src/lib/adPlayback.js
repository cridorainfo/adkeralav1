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
