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
