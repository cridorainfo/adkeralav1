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
  if (!mediaFile && !audioFile) return null;
  return {
    id: ad.id,
    name: String(ad.name ?? '').trim(),
    type: ad.type === 'video' ? 'video' : 'image',
    mediaFile,
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
