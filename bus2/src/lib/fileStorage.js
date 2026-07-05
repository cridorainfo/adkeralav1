/** Convert db/info.txt JSON into app state shape (paths → URLs). */
import { hubFetch } from '#hub/api';
import { getHubToken } from '#hub/persist';
import { mergeRemoteState, defaultState } from '../store/busStore.js';

export const MEDIA_BASE = '/db/media';

export function hydrateStateFromFile(data) {
  return {
    ...data,
    ads: (data.ads ?? []).map(deserializeAd),
    bannerAds: (data.bannerAds ?? []).map(deserializeAd),
    audioFragments: deserializeAudioMap(data.audioFragments),
    stopAudio: deserializeAudioMap(data.stopAudio),
  };
}

export function mediaPathToUrl(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('http') || filePath.startsWith('data:')) return filePath;
  if (filePath.startsWith('/db/')) return filePath;
  return `${MEDIA_BASE}/${String(filePath).replace(/^\/+/, '')}`;
}

export function mediaUrlToPath(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return null;
  const prefix = `${MEDIA_BASE}/`;
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  const dbMediaIdx = url.indexOf('/db/media/');
  if (dbMediaIdx >= 0) return url.slice(dbMediaIdx + '/db/media/'.length);
  if (!url.includes('/') && !url.startsWith('http')) return url;
  return null;
}

function normalizeMediaRelPath(pathOrUrl) {
  if (!pathOrUrl) return null;
  const rel = pathOrUrl.includes('/') || pathOrUrl.startsWith('http')
    ? mediaUrlToPath(pathOrUrl) ?? (pathOrUrl.startsWith('http') ? null : pathOrUrl)
    : pathOrUrl;
  if (!rel) return null;
  return String(rel).replace(/^\/+/, '');
}

function serializeAd(ad) {
  const { mediaUrl, audioUrl, mediaFile, audioFile, ...rest } = ad;
  return {
    ...rest,
    mediaFile: mediaFile ?? mediaUrlToPath(mediaUrl),
    audioFile: audioFile ?? mediaUrlToPath(audioUrl),
  };
}

/** Collect db/media relative paths referenced by one ad (video/image + optional audio). */
export function getAdMediaPaths(ad) {
  if (!ad) return [];
  const paths = new Set();
  for (const candidate of [ad.mediaFile, ad.audioFile, ad.mediaUrl, ad.audioUrl]) {
    const rel = normalizeMediaRelPath(candidate);
    if (rel) paths.add(rel);
  }
  return [...paths];
}

/** All media paths still referenced by remaining ads and banner ads. */
export function collectUsedAdMediaPaths(ads = [], bannerAds = []) {
  const used = new Set();
  for (const ad of [...ads, ...bannerAds]) {
    for (const relPath of getAdMediaPaths(ad)) {
      used.add(relPath);
    }
  }
  return used;
}

export async function deleteMediaFromDb(relPath) {
  if (!relPath) return { ok: true };
  const res = await fetch(`/api/media/file?path=${encodeURIComponent(relPath)}`, {
    method: 'DELETE',
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not delete media file');
  return { ok: true };
}

/** Delete media files from an ad that are no longer referenced elsewhere. */
export async function deleteUnusedAdMedia(ad, stillUsedPaths) {
  const stillUsed =
    stillUsedPaths instanceof Set ? stillUsedPaths : collectUsedAdMediaPaths(stillUsedPaths);
  const toDelete = getAdMediaPaths(ad).filter((relPath) => !stillUsed.has(relPath));
  if (!toDelete.length) return;
  await deleteMediaPaths(toDelete);
}

export function getStopAudioEntryPaths(entry) {
  const paths = [];
  for (const lang of Object.keys(entry ?? {})) {
    const file = entry[lang]?.audioFile ?? mediaUrlToPath(entry[lang]?.audioUrl);
    if (file) paths.push(file);
  }
  return paths;
}

/** Remove stopAudio entries for stops no longer on any route; return files to delete. */
export function pruneStopAudioMap(stopAudio, usedKeys) {
  const used = usedKeys instanceof Set ? usedKeys : new Set(usedKeys);
  const nextStopAudio = { ...(stopAudio ?? {}) };
  const removedPaths = [];

  for (const key of Object.keys(nextStopAudio)) {
    if (!used.has(key)) {
      removedPaths.push(...getStopAudioEntryPaths(nextStopAudio[key]));
      delete nextStopAudio[key];
    }
  }

  return { nextStopAudio, removedPaths };
}

export async function deleteMediaPaths(paths) {
  if (!(await isDbApiAvailable())) return;
  const unique = [...new Set((paths ?? []).filter(Boolean))];
  await Promise.all(unique.map((relPath) => deleteMediaFromDb(relPath).catch(() => {})));
}

function deserializeAd(ad) {
  const { mediaFile, audioFile, ...rest } = ad;
  return {
    ...rest,
    mediaUrl: mediaPathToUrl(mediaFile ?? ad.mediaUrl),
    audioUrl: mediaPathToUrl(audioFile ?? ad.audioUrl),
  };
}

function serializeAudioMap(map = {}) {
  const out = {};
  for (const [key, langs] of Object.entries(map)) {
    out[key] = {};
    for (const [lang, entry] of Object.entries(langs ?? {})) {
      const file = entry?.audioFile ?? mediaUrlToPath(entry?.audioUrl);
      if (file) out[key][lang] = { audioFile: file };
    }
  }
  return out;
}

function deserializeAudioMap(map = {}) {
  const out = {};
  for (const [key, langs] of Object.entries(map)) {
    out[key] = {};
    for (const [lang, entry] of Object.entries(langs ?? {})) {
      const url = mediaPathToUrl(entry?.audioFile ?? entry?.audioUrl);
      if (url) out[key][lang] = { audioUrl: url };
    }
  }
  return out;
}

/** Strip UI-only fields before writing info.txt; keep live sync fields for multi-device. */
export function serializeStateForFile(state) {
  const {
    announcementStatus,
    navigateRequest,
    appView,
    isFullscreen,
    connectedDeviceCount,
    driverLink,
    busProfile,
    ...rest
  } = state;

  const {
    pairingCode: _pairingCode,
    devicesDisconnectLastApplied: _disconnectAt,
    ...busProfileRest
  } = busProfile ?? {};

  const req = state.announcementRequest;
  const announcementRequest =
    req?.id && req?.at
      ? {
          id: req.id,
          stopEn: req.stopEn,
          isTerminus: Boolean(req.isTerminus),
          at: req.at,
        }
      : null;

  return {
    ...rest,
    ...(Object.keys(busProfileRest).length ? { busProfile: busProfileRest } : {}),
    savedAt: state.savedAt ?? Date.now(),
    displayView: state.displayView ?? 'route',
    announcementRequest,
    ads: (state.ads ?? []).map(serializeAd),
    bannerAds: (state.bannerAds ?? []).map(serializeAd),
    audioFragments: serializeAudioMap(state.audioFragments),
    stopAudio: serializeAudioMap(state.stopAudio),
  };
}

export async function saveStateToDb(state) {
  const body = serializeStateForFile(state);
  const headers = { 'Content-Type': 'application/json' };
  const token = getHubToken();
  if (token) headers['X-Hub-Token'] = token;
  const res = await fetch('/api/state', {
    method: 'POST',
    headers,
    body: JSON.stringify(body, null, 2),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(json.error || 'Could not save db/info.txt');
    if (json.code) err.code = json.code;
    else if (res.status === 403) err.code = 'DRIVER_LOCKED';
    throw err;
  }
  return { ok: true };
}

export async function fetchStateFromDb() {
  const res = await hubFetch('/api/state');
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Could not load db/info.txt');
  return mergeRemoteState(defaultState(), hydrateStateFromFile(json.data ?? {}));
}

export async function uploadMediaFile(category, file, suggestedName) {
  const form = new FormData();
  form.append('file', file, suggestedName || file.name || 'upload.bin');
  const headers = {};
  const token = getHubToken();
  if (token) headers['X-Hub-Token'] = token;
  const res = await fetch(`/api/media/${category}`, { method: 'POST', headers, body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Upload failed');
  return { path: json.path, url: json.url };
}

/** Upload a data-URL blob (recorded audio) to db/media/ */
export async function uploadDataUrl(category, dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  return uploadMediaFile(category, file, filename);
}

export async function isDbApiAvailable() {
  try {
    const res = await hubFetch('/api/state', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}
