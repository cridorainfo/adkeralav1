import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { applyCloudCommands, buildDisplaySnapshot, collectMediaDownloads } from './cloudCommands.js';
import { syncCloudMedia } from './cloudMediaSync.js';
import { getStopInfo, generatePairingCode } from '../src/store/busStore.js';
import { getLanAddresses } from './networkInfo.js';
import {
  loadDeviceConfig,
  getDeviceCredentials,
  applyClaimCredentials,
  isDeviceClaimed,
} from './deviceConfig.js';
import { mergeAudioMap } from './audioMerge.js';
import { APP_VERSION } from './version.js';
import { DEFAULT_CLOUD_URLS, resolveCloudUrl } from '../shared/cloudUrls.js';

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';
const SYNC_INTERVAL_MS = Number(process.env.ADKERALA_CLOUD_INTERVAL_MS ?? 5000);
const ENROLL_POLL_MS = 3000;

let lastPushedAt = 0;
let dataRootRef = null;

function getCredentials(dataRoot) {
  return getDeviceCredentials(dataRoot ?? dataRootRef);
}

async function cloudFetch(creds, path, options = {}) {
  const cloudUrl = creds.cloudUrl;
  if (!cloudUrl) return null;
  const headers = {
    'Content-Type': 'application/json',
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${cloudUrl}${path}`, { ...options, headers });
  return res.json().catch(() => null);
}

function buildTelemetry(state, busId) {
  const stopInfo = getStopInfo(state);
  const current = stopInfo.atTripStart ? stopInfo.start : stopInfo.current;
  const upcoming = stopInfo.allStops?.[state.currentStopIndex + 1] ?? stopInfo.final;

  return {
    busId,
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
    lanIp: getLanAddresses()[0]?.address ?? null,
    controlPort: Number(process.env.PORT ?? 5174),
    pairingCode: state.busProfile?.pairingCode ?? null,
    plateDisplay: state.busProfile?.plateDisplay || state.busProfile?.plate || null,
    linkedDriverId: state.driverLink?.driverId ?? null,
    appVersion: APP_VERSION,
    installId: loadDeviceConfig(dataRootRef).installId,
  };
}

async function tryFleetEnrollment(root) {
  const config = loadDeviceConfig(root);
  const creds = getDeviceCredentials(root);
  if (!creds.cloudUrl) return creds;
  if (creds.busId && creds.deviceToken) return creds;

  await cloudFetch(creds, '/api/fleet/enroll', {
    method: 'POST',
    body: JSON.stringify({
      installId: config.installId,
      fleetClaimCode: config.fleetClaimCode,
      appVersion: APP_VERSION,
    }),
  });

  const status = await cloudFetch(creds, `/api/fleet/enroll/${encodeURIComponent(config.installId)}/status`);
  if (status?.claimed && status.deviceToken && status.busId) {
    applyClaimCredentials(root, {
      busId: status.busId,
      deviceToken: status.deviceToken,
      cloudUrl: creds.cloudUrl,
    });
    return getDeviceCredentials(root);
  }

  return creds;
}

async function syncGlobalPhraseAudio(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const res = await fetch(`${creds.cloudUrl}/api/announcements/phrases`, {
      headers: {
        ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
        ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
      },
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
      await syncCloudMedia(root, json.mediaFiles, creds);
    }
  } catch {
    /* cloud offline */
  }
}

/** Push bus telemetry + pull per-bus command queue when cloud URL is configured. */
export async function runCloudSync(root) {
  dataRootRef = root;
  let creds = await tryFleetEnrollment(root);
  if (!creds.cloudUrl) return;

  const busId = creds.busId ?? process.env.ADKERALA_BUS_ID ?? null;
  if (!busId) return;

  let state;
  try {
    state = await readInfoFile(root);
  } catch (err) {
    console.warn('AdKerala cloud sync: could not read db/info.txt —', err.message);
    return;
  }
  if (!state) return;

  if (!state.busProfile?.pairingCode) {
    state = {
      ...state,
      busProfile: {
        ...(state.busProfile ?? {}),
        pairingCode: generatePairingCode(),
      },
      savedAt: Date.now(),
    };
    await writeInfoFileSerialized(root, state);
  }

  const telemetry = buildTelemetry(state, busId);
  const displaySnapshot = buildDisplaySnapshot(state);

  await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ telemetry, state, displaySnapshot }),
  });

  const pending = await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/commands`);
  if (pending?.ok && Array.isArray(pending.commands) && pending.commands.length) {
    const mediaPaths = collectMediaDownloads(pending.commands);
    const current = (await readInfoFile(root)) ?? {};
    const merged = applyCloudCommands(current, pending.commands);
    await writeInfoFileSerialized(root, merged);
    await syncCloudMedia(root, mediaPaths, creds);

    for (const cmd of pending.commands) {
      await cloudFetch(
        creds,
        `/api/buses/${encodeURIComponent(busId)}/commands/${encodeURIComponent(cmd.id)}/ack`,
        { method: 'POST', body: '{}' }
      );
    }
  }

  lastPushedAt = Date.now();
  await syncGlobalPhraseAudio(root, creds);
}

export function startCloudSyncLoop(root) {
  dataRootRef = root;
  const creds = getDeviceCredentials(root);
  if (!creds.cloudUrl) {
    console.log('  Cloud:   (disabled — set ADKERALA_CLOUD_URL or VITE_CLOUD_URL to enable)\n');
    return () => {};
  }

  const busLabel = creds.busId ?? '(awaiting fleet claim)';
  console.log(`  Cloud:   ${creds.cloudUrl}  (bus ${busLabel})\n`);

  const jitter = Math.floor(Math.random() * 1000);
  const tick = () => {
    runCloudSync(root).catch((err) => {
      if (Date.now() - lastPushedAt > 60000) {
        console.warn('AdKerala cloud sync:', err.message);
      }
    });
  };

  setTimeout(tick, jitter);
  const id = setInterval(tick, SYNC_INTERVAL_MS);
  return () => clearInterval(id);
}

export function getCloudConfig(root) {
  const creds = getDeviceCredentials(root ?? dataRootRef);
  const envCloud = resolveCloudUrl(process.env);
  return {
    cloudUrl: creds.cloudUrl || envCloud,
    publicUrl: envCloud || DEFAULT_PUBLIC_CLOUD_URL,
    cloudUrls: DEFAULT_CLOUD_URLS,
    busId: creds.busId,
    enabled: Boolean(creds.cloudUrl || envCloud),
    claimed: isDeviceClaimed(root ?? dataRootRef),
    installId: creds.installId,
    fleetClaimCode: creds.fleetClaimCode,
  };
}

export { ENROLL_POLL_MS };
