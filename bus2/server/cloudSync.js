import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { applyCloudCommands, buildDisplaySnapshot, collectMediaDownloads } from './cloudCommands.js';
import { syncCloudMedia } from './cloudMediaSync.js';
import { getStopInfo } from '../src/store/busStore.js';

import { mergeAudioMap } from './audioMerge.js';

function getCloudUrl() {
  return (process.env.ADKERALA_CLOUD_URL ?? '').replace(/\/+$/, '');
}

function getBusId() {
  return process.env.ADKERALA_BUS_ID ?? 'bus-1';
}

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';
const SYNC_INTERVAL_MS = Number(process.env.ADKERALA_CLOUD_INTERVAL_MS ?? 5000);

let lastPushedAt = 0;

async function cloudFetch(path, options = {}) {
  const cloudUrl = getCloudUrl();
  if (!cloudUrl) return null;
  const headers = {
    'Content-Type': 'application/json',
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${cloudUrl}${path}`, { ...options, headers });
  return res.json().catch(() => null);
}

function buildTelemetry(state) {
  const stopInfo = getStopInfo(state);
  const current = stopInfo.atTripStart ? stopInfo.start : stopInfo.current;
  const upcoming = stopInfo.allStops?.[state.currentStopIndex + 1] ?? stopInfo.final;

  return {
    busId: getBusId(),
    savedAt: state.savedAt ?? Date.now(),
    activeRouteId: state.activeRouteId ?? null,
    routeName: stopInfo.routeName ?? null,
    currentStopIndex: state.currentStopIndex ?? 0,
    currentStopEn: current?.en ?? null,
    currentStopMl: current?.ml ?? null,
    nextStopEn: upcoming?.en ?? null,
    nextStopMl: upcoming?.ml ?? null,
    tripDeparted: Boolean(state.tripDeparted),
    routeDirection: state.routeDirection ?? 'forward',
    displayView: state.displayView ?? 'route',
    adsCount: (state.ads ?? []).length,
    bannerAdsCount: (state.bannerAds ?? []).length,
    announcementRequest: state.announcementRequest ?? null,
    driverLocation: state.driverLocation ?? null,
  };
}

async function syncGlobalPhraseAudio(root) {
  const cloudUrl = getCloudUrl();
  if (!cloudUrl) return;

  try {
    const res = await fetch(`${cloudUrl}/api/announcements/phrases`, {
      headers: BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {},
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.ok || !json.audioFragments) return;

    const current = (await readInfoFile(root)) ?? {};
    const merged = {
      ...current,
      audioFragments: mergeAudioMap(current.audioFragments, json.audioFragments),
      savedAt: Math.max(current.savedAt ?? 0, json.savedAt ?? 0, Date.now()),
    };
    await writeInfoFileSerialized(root, merged);

    if (Array.isArray(json.mediaFiles) && json.mediaFiles.length) {
      await syncCloudMedia(root, json.mediaFiles);
    }
  } catch {
    /* cloud offline */
  }
}

/** Push bus telemetry + pull per-bus command queue when cloud URL is configured. */
export async function runCloudSync(root) {
  const cloudUrl = getCloudUrl();
  const busId = getBusId();
  if (!cloudUrl) return;

  let state;
  try {
    state = await readInfoFile(root);
  } catch (err) {
    console.warn('AdKerala cloud sync: could not read db/info.txt —', err.message);
    return;
  }
  if (!state) return;

  const telemetry = buildTelemetry(state);
  const displaySnapshot = buildDisplaySnapshot(state);

  await cloudFetch(`/api/buses/${encodeURIComponent(busId)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ telemetry, state, displaySnapshot }),
  });

  const pending = await cloudFetch(`/api/buses/${encodeURIComponent(busId)}/commands`);
  if (pending?.ok && Array.isArray(pending.commands) && pending.commands.length) {
    const mediaPaths = collectMediaDownloads(pending.commands);
    const current = (await readInfoFile(root)) ?? {};
    const merged = applyCloudCommands(current, pending.commands);
    await writeInfoFileSerialized(root, merged);
    await syncCloudMedia(root, mediaPaths);

    for (const cmd of pending.commands) {
      await cloudFetch(
        `/api/buses/${encodeURIComponent(busId)}/commands/${encodeURIComponent(cmd.id)}/ack`,
        { method: 'POST', body: '{}' }
      );
    }
  }

  lastPushedAt = Date.now();
  await syncGlobalPhraseAudio(root);
}

export function startCloudSyncLoop(root) {
  const cloudUrl = getCloudUrl();
  const busId = getBusId();
  if (!cloudUrl) {
    console.log('  Cloud:   (disabled — set ADKERALA_CLOUD_URL to enable admin dashboard sync)\n');
    return () => {};
  }

  console.log(`  Cloud:   ${cloudUrl}  (bus ${busId})\n`);

  const tick = () => {
    runCloudSync(root).catch((err) => {
      if (Date.now() - lastPushedAt > 60000) {
        console.warn('AdKerala cloud sync:', err.message);
      }
    });
  };

  tick();
  const id = setInterval(tick, SYNC_INTERVAL_MS);
  return () => clearInterval(id);
}

export function getCloudConfig() {
  const cloudUrl = getCloudUrl();
  return { cloudUrl, busId: getBusId(), enabled: Boolean(cloudUrl) };
}
