import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { notifyStateChanged } from './stateEvents.js';
import { applyCloudCommands, buildDisplaySnapshot, collectMediaDownloads, collectAdMediaFromState } from './cloudCommands.js';
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
    if (!Object.keys(json.audioFragments).length && !(json.mediaFiles?.length)) return;

    const current = (await readInfoFile(root)) ?? {};
    const pushAt = Date.now();
    const merged = {
      ...current,
      audioFragments: mergeAudioMap(current.audioFragments, json.audioFragments),
      savedAt: Math.max(current.savedAt ?? 0, json.savedAt ?? 0, pushAt),
      lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
    };
    await writeInfoFileSerialized(root, merged, { source: 'cloud-phrases' });

    if (Array.isArray(json.mediaFiles) && json.mediaFiles.length) {
      await syncCloudMedia(root, json.mediaFiles, creds);
      notifyStateChanged(root, {
        savedAt: merged.savedAt,
        lastCloudPushAt: merged.lastCloudPushAt,
        source: 'cloud-media',
      });
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
    const current = (await readInfoFile(root)) ?? {};
    const merged = applyCloudCommands(current, pending.commands);
    const mediaPaths = [
      ...new Set([
        ...collectMediaDownloads(pending.commands),
        ...collectAdMediaFromState(merged),
      ]),
    ];
    const pushAt = Date.now();
    merged.savedAt = pushAt;
    merged.lastCloudPushAt = pushAt;
    await writeInfoFileSerialized(root, merged, { source: 'cloud-commands' });
    await syncCloudMedia(root, mediaPaths, creds);
    if (mediaPaths.length) {
      notifyStateChanged(root, {
        savedAt: merged.savedAt,
        lastCloudPushAt: merged.lastCloudPushAt,
        source: 'cloud-media',
      });
    }

    for (const cmd of pending.commands) {
      await cloudFetch(
        creds,
        `/api/buses/${encodeURIComponent(busId)}/commands/${encodeURIComponent(cmd.id)}/ack`,
        { method: 'POST', body: '{}' }
      );
    }
    console.log(
      `AdKerala cloud sync: applied ${pending.commands.length} command(s) — routes/audio updated in db/info.txt`
    );
  }

  lastPushedAt = Date.now();
  await syncGlobalPhraseAudio(root, creds);

  // Catch up any ad/banner media referenced in state but not yet on disk.
  try {
    const latest = await readInfoFile(root);
    const adPaths = collectAdMediaFromState(latest ?? {});
    if (adPaths.length) {
      const downloaded = await syncCloudMedia(root, adPaths, creds);
      if (downloaded > 0) {
        notifyStateChanged(root, {
          savedAt: latest?.savedAt ?? 0,
          lastCloudPushAt: latest?.lastCloudPushAt ?? 0,
          source: 'cloud-media',
        });
      }
    }
  } catch {
    /* ignore */
  }
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

/** Verify driver pairing code + admin OTP via cloud (bus device token). */
export async function verifyDriverControlOnCloud(dataRoot, pairingCode, otp) {
  const creds = getDeviceCredentials(dataRoot ?? dataRootRef);
  if (!creds.cloudUrl) {
    return { ok: false, error: 'Cloud not configured on this bus' };
  }
  if (!creds.busId) {
    return { ok: false, error: 'Bus not claimed — use admin portal first' };
  }
  const json = await cloudFetch(creds, `/api/buses/${encodeURIComponent(creds.busId)}/verify-driver-control`, {
    method: 'POST',
    body: JSON.stringify({ pairingCode, otp }),
  });
  return json ?? { ok: false, error: 'Cloud unreachable' };
}

export { ENROLL_POLL_MS };
