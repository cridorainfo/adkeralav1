import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { notifyStateChanged } from './stateEvents.js';
import { applyCloudCommands, buildDisplaySnapshot, collectMediaDownloads, collectAdMediaFromState, collectAudioMediaFromState } from './cloudCommands.js';
import { syncCloudMedia, deleteLocalMediaFiles } from './cloudMediaSync.js';
import { getStopInfo } from '../src/store/busStore.js';
import { getLanAddresses } from './networkInfo.js';
import {
  loadDeviceConfig,
  getDeviceCredentials,
  applyClaimCredentials,
  clearDeviceClaim,
  isDeviceClaimed,
} from './deviceConfig.js';
import { resetBusStateForUnclaim } from './fleetUnclaim.js';
import { isFleetRevoked } from './fleetRevoke.js';
import { clearAllHubSessions, disconnectAllDrivers, readDevicesDisconnectAt } from './hubSessions.js';
import { syncStopAudioWithCatalog } from './audioMerge.js';
import { createRequire } from 'module';
import { APP_VERSION } from './version.js';
import { DEFAULT_CLOUD_URLS, DEFAULT_PUBLIC_CLOUD_URL, resolveCloudUrl } from '../shared/cloudUrls.js';

const require = createRequire(import.meta.url);
const { dispatchKioskCommand } = require('../kiosk/kioskBridge.cjs');

/**
 * Cloud sync is optional and non-blocking. The bus PC is the hub — display, driver control,
 * and db/info.txt + db/media/ all work offline. Cloud is used only for:
 *   1) one-time fleet claim (busId + device token)
 *   2) downloading/updating routes, ads, and audio when internet is available
 * Driver phones never talk to cloud for control — they connect to this PC over LAN.
 */

const KIOSK_COMMAND_TYPES = new Set(['APPLY_UPDATE']);

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';
const SYNC_INTERVAL_MS = Number(process.env.ADKERALA_CLOUD_INTERVAL_MS ?? 5000);
const ENROLL_POLL_MS = 3000;

let lastPushedAt = 0;
let dataRootRef = null;
let unclaimInProgress = false;
let syncRunning = false;

function getCredentials(dataRoot) {
  return getDeviceCredentials(dataRoot ?? dataRootRef);
}

async function handleDeviceRemovedFromFleet(root, reason) {
  if (unclaimInProgress) return;
  unclaimInProgress = true;
  try {
    console.warn(`AdKerala cloud sync: bus removed from fleet (${reason}) — showing claim code`);
    clearDeviceClaim(root);
    await clearAllHubSessions(root);

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
  } finally {
    unclaimInProgress = false;
  }
}

function noteFleetRevokeAttempt(root, reason) {
  return handleDeviceRemovedFromFleet(root, reason);
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
  if (creds.busId && creds.deviceToken) {
    await cloudFetch(creds, `/api/fleet/enroll/${encodeURIComponent(config.installId)}/ack`, {
      method: 'POST',
      body: '{}',
    });
    return creds;
  }

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
    await cloudFetch(creds, `/api/fleet/enroll/${encodeURIComponent(config.installId)}/ack`, {
      method: 'POST',
      body: '{}',
    });
    console.log(`AdKerala cloud sync: fleet claim applied — bus ${status.json.busId}`);
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
    const cloudRoutes = json.routes ?? [];
    if (!cloudRoutes.length && localAssigned.length) {
      return;
    }
    const catalogChanged =
      JSON.stringify(current.stopCatalog ?? []) !== JSON.stringify(json.stopCatalog ?? []);
    const routesChanged = routesSignature(localAssigned) !== routesSignature(json.routes ?? []);
    const revisionAdvanced = cloudSavedAt > localRevision;
    const tripLive = Boolean(current.tripStarted) && !Boolean(current.tripEnded);
    if (tripLive && !revisionAdvanced && !catalogChanged) {
      return;
    }
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

    const routeSyncFingerprint = (state) =>
      JSON.stringify({
        routes: routesSignature(state.routes ?? []),
        assigned: state.busProfile?.assignedRouteIds ?? [],
        activeRouteId: state.activeRouteId ?? null,
        catalog: state.stopCatalog ?? [],
        tripStarted: Boolean(state.tripStarted),
        tripEnded: Boolean(state.tripEnded),
        currentStopIndex: state.currentStopIndex ?? 0,
        driveRevision: state.driveRevision ?? 0,
      });

    if (routeSyncFingerprint(merged) === routeSyncFingerprint(current)) {
      if (revisionAdvanced && cloudSavedAt > localRevision) {
        await writeInfoFileSerialized(
          root,
          { ...current, routesSavedAt: cloudSavedAt },
          { source: 'cloud-routes-revision' }
        );
      }
      return;
    }

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

/** Apply admin-set pairing code from cloud when the bus PC has none yet. */
async function syncPairingCodeFromCloud(root, cloudPairingCode) {
  const code = String(cloudPairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (code.length !== 4) return;

  const current = (await readInfoFile(root)) ?? {};
  const localCode = String(current.busProfile?.pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (localCode.length === 4) return;

  const pushAt = Date.now();
  const merged = {
    ...current,
    busProfile: {
      ...(current.busProfile ?? {}),
      pairingCode: code,
    },
    savedAt: pushAt,
    lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
  };
  await writeInfoFileSerialized(root, merged, { source: 'cloud-pairing-code' });
  notifyStateChanged(root, { savedAt: pushAt, source: 'cloud-pairing-code' });
}

/** Apply admin "disconnect all phones" flag from cloud (bus3-style). */
function cloudDisconnectAlreadyApplied(current = {}, cloudAt = null) {
  if (!cloudAt) return true;
  const applied = readDevicesDisconnectAt(current);
  if (!applied) return false;
  if (String(cloudAt) === String(applied)) return true;
  const cloudMs = Date.parse(cloudAt);
  const appliedMs = Date.parse(applied);
  if (Number.isFinite(cloudMs) && Number.isFinite(appliedMs) && appliedMs >= cloudMs) {
    return true;
  }
  return false;
}

async function syncDevicesDisconnectFromCloud(root, cloudAt, cloudPairingCode = null) {
  if (!cloudAt) return;

  const current = (await readInfoFile(root)) ?? {};
  if (cloudDisconnectAlreadyApplied(current, cloudAt)) return;

  await disconnectAllDrivers(root, {
    disconnectAt: cloudAt,
    pairingCode: cloudPairingCode,
    rotatePairingCode: Boolean(cloudPairingCode),
  });
  console.log('AdKerala cloud sync: admin disconnected all paired phones for this bus');
}

async function syncAdsFromCloud(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const res = await fetch(
      `${creds.cloudUrl}/api/buses/${encodeURIComponent(creds.busId)}/ads`,
      {
        headers: {
          ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
          ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
        },
      }
    );
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.ok) return;

    const current = (await readInfoFile(root)) ?? {};
    const nextAds = Array.isArray(json.ads) ? json.ads : [];
    const nextBannerAds = Array.isArray(json.bannerAds) ? json.bannerAds : [];
    const cloudAdsSavedAt = json.adsSavedAt ?? 0;
    const localAdsSavedAt = current.adsSavedAt ?? 0;

    const catalogChanged =
      cloudAdsSavedAt > localAdsSavedAt ||
      JSON.stringify(current.ads ?? []) !== JSON.stringify(nextAds) ||
      JSON.stringify(current.bannerAds ?? []) !== JSON.stringify(nextBannerAds);
    if (!catalogChanged) return;

    const oldAdPaths = new Set(collectAdMediaFromState(current));
    const pushAt = Date.now();
    const merged = {
      ...current,
      ads: nextAds,
      bannerAds: nextBannerAds,
      adsSavedAt: cloudAdsSavedAt || pushAt,
      savedAt: Math.max(current.savedAt ?? 0, cloudAdsSavedAt, pushAt),
      lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
    };
    const newAdPaths = new Set(collectAdMediaFromState(merged));
    const removedPaths = [...oldAdPaths].filter((p) => !newAdPaths.has(p));
    const mediaPaths = Array.isArray(json.mediaFiles) && json.mediaFiles.length
      ? json.mediaFiles
      : [...newAdPaths];

    await writeInfoFileSerialized(root, merged, { source: 'cloud-ads' });
    if (mediaPaths.length) {
      await syncCloudMedia(root, mediaPaths, creds);
    }
    await deleteLocalMediaFiles(root, removedPaths);
    notifyStateChanged(root, {
      savedAt: merged.savedAt,
      lastCloudPushAt: merged.lastCloudPushAt,
      source: 'cloud-ads',
    });
  } catch {
    /* cloud offline */
  }
}

function mergeDisplaySettingsFromCatalog(current = {}, catalog = {}) {
  const next = { ...current };
  if (catalog.displaySettings) {
    next.displaySettings = {
      ...(current.displaySettings ?? {}),
      ...catalog.displaySettings,
      theme: {
        ...(current.displaySettings?.theme ?? {}),
        ...(catalog.displaySettings?.theme ?? {}),
      },
    };
  }
  if (catalog.adSettings) {
    next.adSettings = { ...(current.adSettings ?? {}), ...catalog.adSettings };
  }
  if (catalog.bannerAdSettings) {
    next.bannerAdSettings = { ...(current.bannerAdSettings ?? {}), ...catalog.bannerAdSettings };
  }
  if (catalog.announcementSettings) {
    next.announcementSettings = {
      ...(current.announcementSettings ?? {}),
      ...catalog.announcementSettings,
    };
  }
  if (catalog.driveSettings) {
    next.driveSettings = { ...(current.driveSettings ?? {}), ...catalog.driveSettings };
  }
  if (catalog.settingsSavedAt) {
    next.settingsSavedAt = catalog.settingsSavedAt;
  }
  return next;
}

async function syncDisplaySettingsFromCloud(root, creds) {
  if (!creds.cloudUrl || !creds.busId) return;

  try {
    const res = await fetch(
      `${creds.cloudUrl}/api/buses/${encodeURIComponent(creds.busId)}/display-settings`,
      {
        headers: {
          ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
          ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
        },
      }
    );
    if (!res.ok) return;
    const json = await res.json();
    if (!json?.ok) return;

    const cloudAt = json.settingsSavedAt ?? 0;
    if (!cloudAt) return;

    const current = (await readInfoFile(root)) ?? {};
    const localAt = current.settingsSavedAt ?? 0;
    if (cloudAt <= localAt) return;

    const pushAt = Date.now();
    const merged = mergeDisplaySettingsFromCatalog(current, json);
    merged.savedAt = Math.max(current.savedAt ?? 0, cloudAt, pushAt);
    merged.lastCloudPushAt = Math.max(current.lastCloudPushAt ?? 0, pushAt);
    merged.settingsSavedAt = cloudAt;

    await writeInfoFileSerialized(root, merged, { source: 'cloud-display-settings' });
    notifyStateChanged(root, {
      savedAt: merged.savedAt,
      lastCloudPushAt: merged.lastCloudPushAt,
      source: 'cloud-display-settings',
    });
  } catch {
    /* cloud offline */
  }
}

async function applyPendingCloudCommands(root, creds, commands) {
  if (!Array.isArray(commands) || !commands.length) return false;

  const busId = creds.busId;
  const kioskCommands = commands.filter((cmd) => KIOSK_COMMAND_TYPES.has(cmd.type));
  const stateCommands = commands.filter((cmd) => !KIOSK_COMMAND_TYPES.has(cmd.type));

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
      await clearAllHubSessions(root);
      merged.driverLink = null;
      merged.connectedDeviceCount = 0;
      merged.busProfile = {
        ...(merged.busProfile ?? {}),
        devicesDisconnectLastApplied:
          merged.busProfile?.devicesDisconnectLastApplied ??
          readDevicesDisconnectAt(current) ??
          new Date().toISOString(),
      };
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

  for (const cmd of commands) {
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
  console.log(
    `AdKerala cloud sync: applied ${parts.join(', ') || commands.length + ' command(s)'}`
  );
  return true;
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
  if (syncRunning) return;
  syncRunning = true;
  dataRootRef = root;
  try {
    await runCloudSyncInner(root);
  } finally {
    syncRunning = false;
  }
}

async function runCloudSyncInner(root) {
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

  const telemetry = buildTelemetry(state, busId);
  const displaySnapshot = buildDisplaySnapshot(state);

  const telemetryRes = await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ telemetry, state, displaySnapshot }),
  });
  if (telemetryRes.ok) {
    lastPushedAt = Date.now();
    await syncDevicesDisconnectFromCloud(
      root,
      telemetryRes.json?.devicesDisconnectAt ?? null,
      telemetryRes.json?.pairingCode ?? null
    );
    await syncPairingCodeFromCloud(root, telemetryRes.json?.pairingCode ?? null);
  } else if (isFleetRevoked(telemetryRes)) {
    await noteFleetRevokeAttempt(root, telemetryRes.json?.error ?? 'telemetry rejected');
    return;
  } else if (!telemetryRes.ok && telemetryRes.status > 0) {
    console.warn(
      `AdKerala cloud sync: telemetry HTTP ${telemetryRes.status} — keeping local claim`
    );
    return;
  }

  let commands = [];
  if (telemetryRes.ok && Array.isArray(telemetryRes.json?.commands)) {
    commands = telemetryRes.json.commands;
    if (telemetryRes.json?.wasOffline && commands.length) {
      console.log(`AdKerala cloud sync: bus back online — flushed ${commands.length} queued command(s)`);
    }
  } else if (telemetryRes.ok) {
    const pending = await cloudFetch(creds, `/api/buses/${encodeURIComponent(busId)}/commands`);
    if (!pending.ok && isFleetRevoked(pending)) {
      await noteFleetRevokeAttempt(root, pending.json?.error ?? 'commands rejected');
      return;
    }
    if (pending.json?.ok && Array.isArray(pending.json.commands)) {
      commands = pending.json.commands;
    }
  }

  if (commands.length) {
    await applyPendingCloudCommands(root, creds, commands);
  }

  lastPushedAt = Date.now();
  await syncAssignedRoutesFromCloud(root, creds);
  await syncDisplaySettingsFromCloud(root, creds);
  await syncAdsFromCloud(root, creds);
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

  const enrollTick = () => {
    if (isDeviceClaimed(root)) return;
    tryFleetEnrollment(root).catch(() => {});
  };

  setTimeout(tick, jitter);
  setTimeout(enrollTick, jitter + 500);
  const id = setInterval(tick, SYNC_INTERVAL_MS);
  const enrollId = setInterval(enrollTick, ENROLL_POLL_MS);
  return () => {
    clearInterval(id);
    clearInterval(enrollId);
  };
}

export function getCloudConfig(root) {
  const creds = getDeviceCredentials(root ?? dataRootRef);
  const envCloud = resolveCloudUrl(process.env);
  const syncUrl = creds.cloudUrl || envCloud;
  return {
    cloudUrl: syncUrl,
    publicUrl: syncUrl || envCloud || DEFAULT_PUBLIC_CLOUD_URL,
    cloudUrls: DEFAULT_CLOUD_URLS,
    busId: creds.busId,
    enabled: Boolean(syncUrl),
    claimed: isDeviceClaimed(root ?? dataRootRef),
    installId: creds.installId,
    fleetClaimCode: isDeviceClaimed(root ?? dataRootRef) ? null : creds.fleetClaimCode,
    requireFleetClaim: Boolean(loadDeviceConfig(root ?? dataRootRef).requireFleetClaim),
  };
}

/** True when db/info.txt + db/media/ already have enough content to run the bus offline. */
export async function getHubStatus(dataRoot) {
  try {
    const state = (await readInfoFile(dataRoot ?? dataRootRef)) ?? {};
    const routes = state.routes ?? [];
    const ads = state.ads ?? [];
    const bannerAds = state.bannerAds ?? [];
    const stopAudio = state.stopAudio ?? {};
    const hubReady =
      routes.length > 0 ||
      ads.length > 0 ||
      bannerAds.length > 0 ||
      Object.keys(stopAudio).length > 0;
    return {
      hubReady,
      localRoutes: routes.length,
      localAds: ads.length + bannerAds.length,
    };
  } catch {
    return { hubReady: false, localRoutes: 0, localAds: 0 };
  }
}

/** Cloud-paired driver unlock on bus LAN. */
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
