/** Normalize ad entries for cloud catalog storage (relative media paths). */

export function mediaUrlToRelPath(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:')) return null;
  const prefix = '/db/media/';
  const idx = url.indexOf(prefix);
  if (idx >= 0) return url.slice(idx + prefix.length);
  if (!url.startsWith('http') && url.includes('/')) return url.replace(/^\/+/, '');
  return null;
}

export function normalizeAdForCatalog(ad) {
  if (!ad?.id) return null;
  const mediaFile = ad.mediaFile ?? mediaUrlToRelPath(ad.mediaUrl) ?? null;
  const audioFile = ad.audioFile ?? mediaUrlToRelPath(ad.audioUrl) ?? null;
  const name = String(ad.name ?? '').trim();
  if (!mediaFile && !audioFile && !name) return null;
  return {
    id: ad.id,
    name,
    type: ad.type === 'video' ? 'video' : 'image',
    ...(mediaFile ? { mediaFile } : {}),
    ...(audioFile ? { audioFile } : {}),
    durationSec: Number.isFinite(Number(ad.durationSec)) ? Number(ad.durationSec) : 12,
    ...(ad.adFormat ? { adFormat: ad.adFormat } : {}),
    ...(ad.width ? { width: ad.width } : {}),
    ...(ad.height ? { height: ad.height } : {}),
    // Round-trips through the bus's own ad catalog so play events reported back (see
    // BusStoreProvider.jsx's endAd()) can be attributed to the campaign that bought the slot.
    ...(ad.campaignId ? { campaignId: ad.campaignId } : {}),
    // Total budget (currency) this ad is allowed to spend before it's excluded from rotation —
    // see cloud/pricing.js for how spend is computed from reported plays.
    ...(Number.isFinite(Number(ad.amount)) ? { amount: Number(ad.amount) } : {}),
    // Normalized-lowercase-English stop name (matches stopAudioKey in audioFragments.js) this ad
    // should be prioritized for as the bus approaches that stop, instead of purely on a timer.
    ...(ad.triggerStopEn ? { triggerStopEn: String(ad.triggerStopEn).trim().toLowerCase() } : {}),
    // House/free ads never exhaust and fill rotation once paid ads run out of budget.
    ...(ad.isHouseAd ? { isHouseAd: true } : {}),
  };
}

export function normalizeAdsList(list) {
  return (list ?? []).map(normalizeAdForCatalog).filter(Boolean);
}

export function collectAdMediaPathsFromLists(ads = [], bannerAds = []) {
  const paths = new Set();
  for (const ad of [...ads, ...bannerAds]) {
    if (ad?.mediaFile) paths.add(ad.mediaFile);
    if (ad?.audioFile) paths.add(ad.audioFile);
  }
  return [...paths];
}

/** Media paths removed from a catalog update (safe to delete when unreferenced). */
export function collectRemovedAdMediaPaths(prevAds = [], prevBanners = [], nextAds = [], nextBanners = []) {
  const prev = new Set(collectAdMediaPathsFromLists(prevAds, prevBanners));
  const next = new Set(collectAdMediaPathsFromLists(nextAds, nextBanners));
  return [...prev].filter((p) => !next.has(p));
}
