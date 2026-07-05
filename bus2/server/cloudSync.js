import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { notifyStateChanged } from './stateEvents.js';
import { applyCloudCommands, buildDisplaySnapshot, collectMediaDownloads, collectAdMediaFromState, collectAudioMediaFromState } from './cloudCommands.js';
import { syncCloudMedia, deleteLocalMediaFiles } from './cloudMediaSync.js';
import { getStopInfo, generatePairingCode } from '../src/store/busStore.js';
import { getLanAddresses } from './networkInfo.js';
import {
  loadDeviceConfig,
  getDeviceCredentials,
  applyClaimCredentials,
  clearDeviceClaim,
  isDeviceClaimed,
} from './deviceConfig.js';
import { resetBusStateForUnclaim } from './fleetUnclaim.js';
import { isFleetRevoked, REVOKE_STRIKES_REQUIRED } from './fleetRevoke.js';
import { clearAllDriverSessions } from './driverAuth.js';
import { syncStopAudioWithCatalog } from './audioMerge.js';
import { createRequire } from 'module';
import { APP_VERSION } from './version.js';
import { DEFAULT_CLOUD_URLS, resolveCloudUrl } from '../shared/cloudUrls.js';

const require = createRequire(import.meta.url);
const { dispatchKioskCommand } = require('../kiosk/kioskBridge.cjs');

const KIOSK_COMMAND_TYPES = new Set(['APPLY_UPDATE']);

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';
const SYNC_INTERVAL_MS = Number(process.env.ADKERALA_CLOUD_INTERVAL_MS ?? 5000);
const ENROLL_POLL_MS = 3000;

let lastPushedAt = 0;
let dataRootRef = null;
let unclaimInProgress = false;
let revokeStrikeCount = 0;

function getCredentials(dataRoot) {
  return getDeviceCredentials(dataRoot ?? dataRootRef);
}

async function handleDeviceRemovedFromFleet(root, reason) {
  if (unclaimInProgress) return;
  unclaimInProgress = true;
  try {
    console.warn(`AdKerala cloud sync: bus removed from fleet (${reason}) — showing claim code`);
    clearDeviceClaim(root);
    await clearAllDriverSessions(root);

    const current = (await readInfoFile(root)) ?? {};
    const oldMediaPaths = [
      ...new Set([
        ...collectAdMediaFromState(current),
        ...collectAudioMediaFromState(current),
      ]),
    ];
    const merged = resetBusStateForUnclaim(current);
    const pushAt = Date.now();
    merged.savedAt = pushAt;
    merged.lastCloudPushAt = pushAt;

    await writeInfoFileSerialized(root, merged, { source: 'fleet-unclaim' });
    await deleteLocalMediaFiles(root, oldMediaPaths);
    notifyStateChanged(root, {
      savedAt: pushAt,
      lastCloudPushAt: pushAt,
      source: 'fleet-unclaim',
    });
    revokeStrikeCount = 0;
  } finally {
    unclaimInProgress = false;
  }
}

function noteFleetRevokeAttempt(root, reason) {
  revokeStrikeCount += 1;
  console.warn(
    `AdKerala cloud sync: bus token rejected (${reason}) — strike ${revokeStrikeCount}/${REVOKE_STRIKES_REQUIRED}`
  );
  if (revokeStrikeCount >= REVOKE_STRIKES_REQUIRED) {
    return handleDeviceRemovedFromFleet(root, reason);
  }
  return undefined;
}

async function cloudFetch(creds, path, options = {}) {
  const cloudUrl = creds.cloudUrl;
  if (!cloudUrl) return { ok: false, status: 0, json: null };
  const headers = {
    'Content-Type': 'application/json',
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${cloudUrl}${path}`, { ...options, headers });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
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
  if (status.json?.claimed && status.json.deviceToken && status.json.busId) {
    applyClaimCredentials(root, {
      busId: status.json.busId,
      deviceToken: status.json.deviceToken,
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
    if (!json?.ok) return;

    const cloudFragments = json.audioFragments ?? {};
    const current = (await readInfoFile(root)) ?? {};
    const oldPaths = new Set(collectAudioMediaFromState({ audioFragments: current.audioFragments }));
    const newPaths = new Set(collectAudioMediaFromState({ audioFragments: cloudFragments }));
    const removedPaths = [...oldPaths].filter((p) => !newPaths.has(p));
    const pushAt = Date.now();
    const merged = {
      ...current,
      audioFragments: cloudFragments,
      savedAt: Math.max(current.savedAt ?? 0, json.savedAt ?? 0, pushAt),
      lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
    };
    const changed =
      removedPaths.length > 0 ||
      JSON.stringify(current.audioFragments ?? {}) !== JSON.stringify(cloudFragments);
    if (!changed && !(json.mediaFiles?.length)) return;

    await writeInfoFileSerialized(root, merged, { source: 'cloud-phrases' });
    if (Array.isArray(json.mediaFiles) && json.mediaFiles.length) {
      await syncCloudMedia(root, json.mediaFiles, creds);
    }
    await deleteLocalMediaFiles(root, removedPaths);
    if (removedPaths.length || json.mediaFiles?.length) {
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

async function syncAssignedRoutesFromCloud(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const res = await fetch(`${creds.cloudUrl}/api/buses/${encodeURIComponent(creds.busId)}/routes`, {
      headers: {
        ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
        ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
      },
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.ok) return;

    const cloudSavedAt = json.routesSavedAt ?? 0;
    const current = (await readInfoFile(root)) ?? {};
    const localRevision = current.routesSavedAt ?? 0;
    const assignedIds = json.assignedRouteIds ?? [];
    const assignedSet = new Set(assignedIds);
    const localAssigned = (current.routes ?? []).filter((r) => assignedSet.has(r.id));
    const catalogChanged =
      JSON.stringify(current.stopCatalog ?? []) !== JSON.stringify(json.stopCatalog ?? []);
    const routesChanged =
      JSON.stringify(localAssigned) !== JSON.stringify(json.routes ?? []);
    const revisionAdvanced = cloudSavedAt > localRevision;
    if (!revisionAdvanced && !catalogChanged && !routesChanged) return;

    const merged = applyCloudCommands(current, [
      {
        type: 'SYNC_ASSIGNED_ROUTES',
        payload: {
          routes: json.routes ?? [],
          assignedRouteIds: assignedIds,
          stopCatalog: json.stopCatalog ?? [],
          removeLocalOrphans: true,
          savedAt: cloudSavedAt || Date.now(),
        },
      },
    ]);

    const pushAt = Date.now();
    merged.savedAt = Math.max(current.savedAt ?? 0, cloudSavedAt, pushAt);
    merged.lastCloudPushAt = Math.max(current.lastCloudPushAt ?? 0, pushAt);
    merged.routesSavedAt = Math.max(localRevision, cloudSavedAt || pushAt);

    await writeInfoFileSerialized(root, merged, { source: 'cloud-routes' });
    notifyStateChanged(root, {
      savedAt: merged.savedAt,
      lastCloudPushAt: merged.lastCloudPushAt,
      source: 'cloud-routes',
    });
  } catch {
    /* cloud offline */
  }
}

/** Apply admin "disconnect all phones" flag from cloud (bus3-style). */
async function syncDevicesDisconnectFromCloud(root, cloudAt) {
  if (!cloudAt) return;

  const current = (await readInfoFile(root)) ?? {};
  const applied = current.busProfile?.devicesDisconnectLastApplied ?? null;
  if (cloudAt === applied) return;

  await clearAllDriverSessions(root);

  const pushAt = Date.now();
  const merged = {
    ...current,
    driverLink: null,
    connectedDeviceCount: 0,
    busProfile: {
      ...(current.busProfile ?? {}),
      devicesDisconnectLastApplied: cloudAt,
    },
    savedAt: pushAt,
    lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
  };

  await writeInfoFileSerialized(root, merged, { source: 'devices-disconnect' });
  notifyStateChanged(root, {
    savedAt: pushAt,
    lastCloudPushAt: merged.lastCloudPushAt,
    source: 'devices-disconnect',
  });
  console.log('AdKerala cloud sync: admin disconnected all paired phones for this bus');
}

/** Cache fleet admin OTP on the bus for offline driver unlock on LAN. */
async function syncDriverControlOtpFromCloud(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const json = await cloudFetch(
      creds,
      `/api/buses/${encodeURIComponent(creds.busId)}/driver-control-otp`
    );
    if (!json.ok || !json.json?.ok || !json.json.otp) return;

    const current = (await readInfoFile(root)) ?? {};
    const profile = current.busProfile ?? {};
    const prevUpdatedAt = profile.driverControlOtpUpdatedAt ?? 0;
    const nextUpdatedAt = Number(json.json.updatedAt ?? 0);
    if (
      profile.driverControlOtp === json.json.otp &&
      nextUpdatedAt <= prevUpdatedAt
    ) {
      return;
    }

    const pushAt = Date.now();
    const merged = {
      ...current,
      busProfile: {
        ...profile,
        driverControlOtp: String(json.json.otp),
        driverControlOtpUpdatedAt: nextUpdatedAt || pushAt,
      },
      savedAt: Math.max(current.savedAt ?? 0, pushAt),
      lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
    };
    await writeInfoFileSerialized(root, merged, { source: 'cloud-driver-otp' });
  } catch {
    /* cloud offline */
  }
}

async function syncStopAudioFromCloud(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const res = await fetch(`${creds.cloudUrl}/api/stops/audio`, {
      headers: {
        ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
        ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
      },
    });
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.ok) return;

    const cloudCatalog = json.stopAudio ?? {};
    const current = (await readInfoFile(root)) ?? {};
    const oldPaths = new Set(collectAudioMediaFromState({ stopAudio: current.stopAudio }));
    const nextStopAudio = syncStopAudioWithCatalog(current.stopAudio, cloudCatalog);
    const newPaths = new Set(collectAudioMediaFromState({ stopAudio: nextStopAudio }));
    const removedPaths = [...oldPaths].filter((p) => !newPaths.has(p));
    const changed =
      removedPaths.length > 0 ||
      JSON.stringify(current.stopAudio ?? {}) !== JSON.stringify(nextStopAudio);
    if (!changed) return;

    const pushAt = Date.now();
    const merged = {
      ...current,
      stopAudio: nextStopAudio,
      savedAt: Math.max(current.savedAt ?? 0, json.savedAt ?? 0, pushAt),
      lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
    };
    await writeInfoFileSerialized(root, merged, { source: 'cloud-stop-audio' });
    await deleteLocalMediaFiles(root, removedPaths);
    notifyStateChanged(root, {
      savedAt: merged.savedAt,
      lastCloudPushAt: merged.lastCloudPushAt,
      source: 'cloud-media',
    });
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

  const telemetryRes = await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ telemetry, state, displaySnapshot }),
  });
  if (telemetryRes.ok) {
    revokeStrikeCount = 0;
    lastPushedAt = Date.now();
    await syncDevicesDisconnectFromCloud(root, telemetryRes.json?.devicesDisconnectAt ?? null);
  } else if (isFleetRevoked(telemetryRes)) {
    await noteFleetRevokeAttempt(root, telemetryRes.json?.error ?? 'telemetry rejected');
    return;
  } else if (!telemetryRes.ok && telemetryRes.status > 0) {
    console.warn(
      `AdKerala cloud sync: telemetry HTTP ${telemetryRes.status} — keeping local claim`
    );
    return;
  }

  const pending = await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/commands`);
  if (!pending.ok && isFleetRevoked(pending)) {
    await noteFleetRevokeAttempt(root, pending.json?.error ?? 'commands rejected');
    return;
  }
  if (pending.json?.ok && Array.isArray(pending.json.commands) && pending.json.commands.length) {
    const kioskCommands = pending.json.commands.filter((cmd) => KIOSK_COMMAND_TYPES.has(cmd.type));
    const stateCommands = pending.json.commands.filter((cmd) => !KIOSK_COMMAND_TYPES.has(cmd.type));

    for (const cmd of kioskCommands) {
      dispatchKioskCommand(cmd.type, cmd.payload ?? {});
    }

    const current = (await readInfoFile(root)) ?? {};

    if (stateCommands.length) {
      const oldAdPaths = new Set(collectAdMediaFromState(current));
      const oldAudioPaths = new Set(collectAudioMediaFromState(current));
      const prevDriverId = current.driverLink?.driverId ?? null;
      const merged = applyCloudCommands(current, stateCommands);
      const nextDriverId = merged.driverLink?.driverId ?? null;
      if (prevDriverId && !nextDriverId) {
        await clearAllDriverSessions(root);
        merged.connectedDeviceCount = 0;
        merged.driverLink = null;
      }
      const newAdPaths = new Set(collectAdMediaFromState(merged));
      const newAudioPaths = new Set(collectAudioMediaFromState(merged));
      const removedAdPaths = [...oldAdPaths].filter((p) => !newAdPaths.has(p));
      const removedAudioPaths = [...oldAudioPaths].filter((p) => !newAudioPaths.has(p));
      const explicitRemoved = stateCommands.flatMap((cmd) =>
        Array.isArray(cmd.payload?.removedMediaFiles) ? cmd.payload.removedMediaFiles : []
      );
      const removedPaths = [
        ...new Set([...removedAdPaths, ...removedAudioPaths, ...explicitRemoved].filter(Boolean)),
      ];
      const mediaPaths = [
        ...new Set([
          ...collectMediaDownloads(stateCommands),
          ...collectAdMediaFromState(merged),
          ...collectAudioMediaFromState(merged),
        ]),
      ];
      const pushAt = Date.now();
      merged.savedAt = pushAt;
      merged.lastCloudPushAt = pushAt;
      await writeInfoFileSerialized(root, merged, { source: 'cloud-commands' });
      await syncCloudMedia(root, mediaPaths, creds);
      await deleteLocalMediaFiles(root, removedPaths);
      notifyStateChanged(root, {
        savedAt: merged.savedAt,
        lastCloudPushAt: merged.lastCloudPushAt,
        source: 'cloud-commands',
      });
    }

    for (const cmd of pending.json.commands) {
      await cloudFetch(
        creds,
        `/api/buses/${encodeURIComponent(busId)}/commands/${encodeURIComponent(cmd.id)}/ack`,
        { method: 'POST', body: '{}' }
      );
    }
    const parts = [];
    if (stateCommands.length) {
      parts.push(`${stateCommands.length} content command(s)`);
    }
    if (kioskCommands.length) {
      parts.push(`${kioskCommands.length} system command(s)`);
    }
    console.log(`AdKerala cloud sync: applied ${parts.join(', ') || pending.json.commands.length + ' command(s)'}`);
  }

  lastPushedAt = Date.now();
  await syncDriverControlOtpFromCloud(root, creds);
  await syncAssignedRoutesFromCloud(root, creds);
  await syncGlobalPhraseAudio(root, creds);
  await syncStopAudioFromCloud(root, creds);

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
    fleetClaimCode: creds.claimed ? null : creds.fleetClaimCode,
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
  return json.json ?? { ok: false, error: 'Cloud unreachable' };
}

/** Cloud-paired driver unlock on bus LAN — no OTP when phone already linked in cloud. */
export async function verifyDriverLinkedOnCloud(dataRoot, driverId) {
  const creds = getDeviceCredentials(dataRoot ?? dataRootRef);
  if (!creds.cloudUrl) {
    return { ok: false, error: 'Cloud not configured on this bus' };
  }
  if (!creds.busId) {
    return { ok: false, error: 'Bus not claimed' };
  }
  const json = await cloudFetch(
    creds,
    `/api/buses/${encodeURIComponent(creds.busId)}/verify-linked-driver`,
    {
      method: 'POST',
      body: JSON.stringify({ driverId: String(driverId ?? '').trim() }),
    }
  );
  return json.json ?? { ok: false, error: 'Cloud unreachable' };
}

export { ENROLL_POLL_MS };
