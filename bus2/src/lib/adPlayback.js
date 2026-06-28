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
