/** True when an ad entry has a local or remote media reference. */
export function adHasPlayableMedia(ad) {
  if (!ad) return false;
  const url = String(ad.mediaUrl ?? '').trim();
  const file = String(ad.mediaFile ?? '').trim();
  return Boolean(url || file);
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
