import path from 'path';
import { randomBytes } from 'crypto';
import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { notifyStateChanged } from './stateEvents.js';
import { getActiveRoute, getAllStops, getTripStartIndex, generatePairingCode, getDriverVisibleRoutes } from '../src/store/busStore.js';
import { nextDriveRevision } from '../src/store/tripMerge.js';
import {
  atomicWriteTextFile,
  backupPathFor,
  durableWriteTextFile,
  readBestRecoverableFile,
} from './safeFileWrite.js';
import { archiveJsonContent, archiveRelativeLabel, readArchivedJson } from './stateArchive.js';

// Driver LAN sessions persist until the driver taps Disconnect or admin revokes them.
// No idle timeout — phones stay connected across app backgrounding and bus PC reboots.
const HEARTBEAT_MS = 45 * 1000;
const SESSIONS_FILE = '.adkerala-driver-sessions.json';
const CONNECT_RATE_LIMIT = 8;
const CONNECT_RATE_WINDOW_MS = 60 * 1000;

export const DRIVER_TOKEN_HEADER = 'x-driver-token';

let sessions = new Map();
let cleanupTimer = null;
let dataRootRef = null;
const connectAttempts = new Map();

export function isLocalRequest(req) {
  const ip = req.socket?.remoteAddress ?? '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  );
}

export function getDriverTokenFromRequest(req) {
  return String(req.headers[DRIVER_TOKEN_HEADER] ?? req.query?.driverToken ?? '').trim();
}

function sessionsPath(dataRoot) {
  return path.join(dataRoot, SESSIONS_FILE);
}

function isValidSessionsRaw(raw) {
  try {
    const json = JSON.parse(raw);
    return json && typeof json.sessions === 'object';
  } catch {
    return false;
  }
}

function sessionsScore(raw) {
  try {
    const json = JSON.parse(raw);
    const entries = Object.values(json.sessions ?? {});
    return entries.reduce((max, session) => Math.max(max, session?.lastSeenAt ?? 0), 0);
  } catch {
    return 0;
  }
}

async function loadSessionsFromDisk(dataRoot) {
  const file = sessionsPath(dataRoot);
  try {
    const localBest = await readBestRecoverableFile(file, {
      validate: isValidSessionsRaw,
      score: sessionsScore,
    });
    const archiveBest = await readArchivedJson(dataRoot, 'sessions', {
      validate: isValidSessionsRaw,
    });

    let best = localBest;
    if (archiveBest) {
      const archiveScore = sessionsScore(archiveBest.raw);
      if (!best || archiveScore >= best.score) {
        best = { raw: archiveBest.raw, sourcePath: archiveBest.sourcePath, score: archiveScore };
      }
    }

    if (!best) {
      sessions = new Map();
      pruneExpiredSessions();
      return;
    }

    const json = JSON.parse(best.raw);
    sessions = new Map(Object.entries(json.sessions ?? {}));

    if (best.sourcePath !== file) {
      console.warn(
        `AdKerala: recovered driver sessions from ${archiveRelativeLabel(best.sourcePath, dataRoot)} after unexpected shutdown`
      );
      await durableWriteTextFile(file, best.raw);
      await atomicWriteTextFile(backupPathFor(file), best.raw).catch(() => {});
    }
  } catch {
    sessions = new Map();
  }
  pruneExpiredSessions();
}

async function saveSessionsToDisk(dataRoot) {
  try {
    const file = sessionsPath(dataRoot);
    const obj = { sessions: Object.fromEntries(sessions) };
    const content = JSON.stringify(obj);
    await archiveJsonContent(dataRoot, 'sessions', content);
    await durableWriteTextFile(file, content);
    await atomicWriteTextFile(backupPathFor(file), content).catch(() => {});
  } catch {
    /* ignore */
  }
}

function pruneExpiredSessions() {
  /* Sessions no longer expire by time — only explicit disconnect removes them. */
}

export function hasActiveDriverSession() {
  return sessions.size > 0;
}

export function getConnectedDeviceCount() {
  return sessions.size;
}

export function isDriverSessionValid(token) {
  if (!token) return false;
  return sessions.has(token);
}

/** Drop LAN unlock tokens when cloud unlinks the driver from this bus. */
export async function clearDriverSessionsForDriver(dataRoot, driverId) {
  const id = String(driverId ?? '').trim();
  if (!id) return;
  pruneExpiredSessions();
  let removed = false;
  for (const [token, session] of sessions) {
    if (session.driverId === id) {
      sessions.delete(token);
      removed = true;
    }
  }
  if (removed) {
    await saveSessionsToDisk(dataRoot ?? dataRootRef);
    await refreshConnectedDeviceCountInState(dataRoot ?? dataRootRef);
  }
}

/** Admin "disconnect all phones" — every LAN session revoked (bus3-style). */
export async function clearAllDriverSessions(dataRoot) {
  pruneExpiredSessions();
  if (sessions.size === 0) return false;
  sessions.clear();
  await saveSessionsToDisk(dataRoot ?? dataRootRef);
  await refreshConnectedDeviceCountInState(dataRoot ?? dataRootRef);
  return true;
}

export function readDevicesDisconnectAt(state = {}) {
  return (
    state.busProfile?.devicesDisconnectLastApplied ??
    state.busProfile?.devicesDisconnectAt ??
    null
  );
}

/** Revoke every phone session, clear driver link, bump disconnect stamp for phone clients. */
export async function disconnectAllDrivers(dataRoot, options = {}) {
  const root = dataRoot ?? dataRootRef;
  if (!root) return { ok: false, error: 'Missing data root' };

  const disconnectAt =
    typeof options === 'string' ? options : (options.disconnectAt ?? null);
  const rotatePairingCode =
    typeof options === 'string' ? false : options.rotatePairingCode !== false;
  const pairingCodeOverride =
    typeof options === 'string' ? null : (options.pairingCode ?? null);

  pruneExpiredSessions();
  sessions.clear();
  await saveSessionsToDisk(root);

  const stamp = disconnectAt ?? new Date().toISOString();
  const current = (await readInfoFile(root)) ?? {};
  const pushAt = Date.now();
  const route = getActiveRoute(current);
  const dir = current.routeDirection ?? 'forward';
  const stops = route ? getAllStops(route) : [];
  const nextPairingCode = rotatePairingCode
    ? pairingCodeOverride || generatePairingCode()
    : current.busProfile?.pairingCode ?? '';

  const next = {
    ...current,
    driverLink: null,
    connectedDeviceCount: 0,
    tripStarted: false,
    tripEnded: false,
    tripDeparted: false,
    currentStopIndex: route ? getTripStartIndex(stops, dir) : 0,
    displayView: 'route',
    announcementRequest: null,
    driveRevision: nextDriveRevision(current),
    busProfile: {
      ...(current.busProfile ?? {}),
      pairingCode: nextPairingCode,
      devicesDisconnectLastApplied: stamp,
    },
    savedAt: pushAt,
    lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
  };

  await writeInfoFileSerialized(root, next, { source: 'disconnect-all-drivers' });
  notifyStateChanged(root, { savedAt: pushAt, source: 'disconnect-all-drivers' });

  return {
    ok: true,
    devicesDisconnectAt: stamp,
    pairingCode: nextPairingCode,
    connectedDeviceCount: 0,
  };
}

function createDriverSession(driverIdOverride = null) {
  const token = randomBytes(24).toString('hex');
  const driverId =
    driverIdOverride && String(driverIdOverride).trim()
      ? String(driverIdOverride).trim()
      : `phone-${token.slice(0, 12)}`;
  sessions.set(token, { driverId, lastSeenAt: Date.now() });
  return { token, driverId };
}

async function touchSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  session.lastSeenAt = Date.now();
  await saveSessionsToDisk(dataRootRef);
  return true;
}

function normalizePairingCode(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

function checkConnectRateLimit(req, failed = false) {
  if (!failed) return { ok: true };
  const ip = req.socket?.remoteAddress ?? 'unknown';
  const now = Date.now();
  let entry = connectAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + CONNECT_RATE_WINDOW_MS };
    connectAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > CONNECT_RATE_LIMIT) {
    return {
      ok: false,
      status: 429,
      error: 'Too many pairing attempts — wait a minute and try again',
    };
  }
  return { ok: true };
}

/** Offline LAN unlock for a driver already cloud-paired to this bus (driverLink in info.txt). */
function verifyLinkedDriverLocally(state, driverId) {
  const id = String(driverId ?? '').trim();
  if (!id) {
    return { ok: false, error: 'Missing driverId' };
  }

  const linked = state.driverLink?.driverId;
  if (!linked || linked !== id) {
    return { ok: false, error: 'Driver not linked to this bus' };
  }

  return {
    ok: true,
    offline: true,
    plate: state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
  };
}

async function refreshConnectedDeviceCountInState(dataRoot) {
  if (!dataRoot) return;
  const count = getConnectedDeviceCount();
  const current = (await readInfoFile(dataRoot)) ?? {};
  if ((current.connectedDeviceCount ?? 0) === count) return;

  const pushAt = Date.now();
  await writeInfoFileSerialized(
    dataRoot,
    {
      ...current,
      connectedDeviceCount: count,
      savedAt: pushAt,
    },
    { source: 'device-count' }
  );
  notifyStateChanged(dataRoot, { savedAt: pushAt, source: 'device-count' });
}

async function setDriverLink(dataRoot, driverLink) {
  const current = (await readInfoFile(dataRoot)) ?? {};
  const pushAt = Date.now();
  let next = {
    ...current,
    driverLink,
    connectedDeviceCount: getConnectedDeviceCount(),
    savedAt: pushAt,
    lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
  };

  if (!driverLink?.driverId) {
    const route = getActiveRoute(current);
    const dir = current.routeDirection ?? 'forward';
    const stops = route ? getAllStops(route) : [];
    next = {
      ...next,
      tripStarted: false,
      tripEnded: false,
      tripDeparted: false,
      currentStopIndex: route ? getTripStartIndex(stops, dir) : 0,
      displayView: 'route',
      announcementRequest: null,
      driveRevision: nextDriveRevision(current),
    };
  }

  await writeInfoFileSerialized(dataRoot, next, { source: 'driver-link' });
}

async function clearLocalDriverLinkIfIdle(_dataRoot) {
  /* Driver link stays until explicit disconnect — never auto-clear on idle. */
}

/** After reboot, restore driverLink from persisted sessions if info.txt lost the link. */
async function restoreDriverLinkFromSessions(dataRoot) {
  if (sessions.size === 0) return;
  const state = (await readInfoFile(dataRoot)) ?? {};
  if (state.driverLink?.driverId) return;

  const first = sessions.values().next().value;
  if (!first?.driverId) return;

  await setDriverLink(dataRoot, { driverId: first.driverId, linkedAt: Date.now() });
}

function startSessionCleanup(dataRoot) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    clearLocalDriverLinkIfIdle(dataRoot).catch(() => {});
  }, HEARTBEAT_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

/** Offline-first LAN connect — 4-digit pair code only (same as bus3 connect code). */
async function connectWithPairingCode(dataRoot, pairingCode) {
  const code = normalizePairingCode(pairingCode);
  if (!code || code.length !== 4) {
    return { ok: false, status: 400, error: 'Enter the 4-digit code from the bus screen' };
  }

  const state = (await readInfoFile(dataRoot)) ?? {};
  const localCode = normalizePairingCode(state.busProfile?.pairingCode);
  if (!localCode) {
    return {
      ok: false,
      status: 403,
      error: 'No pairing code set — admin must set one in the Fleet panel',
    };
  }
  if (code !== localCode) {
    return { ok: false, status: 403, error: 'Pair code does not match this bus' };
  }

  const session = createDriverSession();
  await saveSessionsToDisk(dataRoot);
  await setDriverLink(dataRoot, {
    driverId: session.driverId,
    linkedAt: Date.now(),
  });

  const fresh = (await readInfoFile(dataRoot)) ?? {};

  return {
    ok: true,
    token: session.token,
    plate: state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
    offline: true,
    devicesDisconnectAt: readDevicesDisconnectAt(fresh),
    connectedDeviceCount: getConnectedDeviceCount(),
  };
}

/** Driver phone unlock — 4-digit pairing code on LAN; cloud-paired shortcut for legacy apps. */
export function setupDriverAuth(app, { dataRoot, verifyLinkedWithCloud }) {
  dataRootRef = dataRoot;
  sessions = new Map();
  connectAttempts.clear();
  loadSessionsFromDisk(dataRoot).then(async () => {
    await restoreDriverLinkFromSessions(dataRoot);
    await refreshConnectedDeviceCountInState(dataRoot);
    startSessionCleanup(dataRoot);
  });

  app.get('/api/driver/unlock-status', async (req, res) => {
    const token = getDriverTokenFromRequest(req);
    const unlocked = isDriverSessionValid(token);
    const state = (await readInfoFile(dataRoot)) ?? {};
    let plate = null;
    if (unlocked) {
      plate = state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null;
    }
    res.json({
      ok: true,
      unlocked,
      plate,
      devicesDisconnectAt: readDevicesDisconnectAt(state),
      connectedDeviceCount: getConnectedDeviceCount(),
    });
  });

  /** Assigned routes on this bus PC — same list the control panel uses (bus3-style). */
  app.get('/api/driver/routes', async (_req, res) => {
    const state = (await readInfoFile(dataRoot)) ?? {};
    const routes = getDriverVisibleRoutes(state);
    res.json({
      ok: true,
      routes,
      activeRouteId: state.activeRouteId ?? null,
      assignedRouteIds: state.busProfile?.assignedRouteIds ?? [],
    });
  });

  app.get('/api/driver/connected', async (_req, res) => {
    const count = getConnectedDeviceCount();
    res.json({
      ok: true,
      connected: count > 0,
      connectedDeviceCount: count,
    });
  });

  app.post('/api/driver/connect', async (req, res) => {
    try {
      const result = await connectWithPairingCode(dataRoot, req.body?.pairingCode ?? req.body?.code);
      if (!result.ok) {
        const limited = checkConnectRateLimit(req, true);
        if (!limited.ok) {
          res.status(limited.status ?? 429).json({ ok: false, error: limited.error });
          return;
        }
        res.status(result.status ?? 400).json({ ok: false, error: result.error });
        return;
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/driver/heartbeat', async (req, res) => {
    const token = getDriverTokenFromRequest(req);
    if (!(await touchSession(token))) {
      res.json({ ok: false, expired: true });
      return;
    }
    const session = sessions.get(token);
    if (session?.driverId) {
      const state = (await readInfoFile(dataRoot)) ?? {};
      if (state.driverLink?.driverId !== session.driverId) {
        await setDriverLink(dataRoot, { driverId: session.driverId, linkedAt: Date.now() });
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/driver/disconnect', async (req, res) => {
    const token = getDriverTokenFromRequest(req);
    if (token) sessions.delete(token);
    await saveSessionsToDisk(dataRoot);
    if (!hasActiveDriverSession()) {
      await setDriverLink(dataRoot, null);
    } else {
      await refreshConnectedDeviceCountInState(dataRoot);
    }
    const state = (await readInfoFile(dataRoot)) ?? {};
    res.json({
      ok: true,
      connectedDeviceCount: getConnectedDeviceCount(),
      devicesDisconnectAt: readDevicesDisconnectAt(state),
    });
  });

  app.post('/api/driver/disconnect-all', async (req, res) => {
    if (!isLocalRequest(req)) {
      res.status(403).json({ ok: false, error: 'Disconnect all is only available on the bus PC' });
      return;
    }
    try {
      const result = await disconnectAllDrivers(dataRoot);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/driver/unlock-paired', async (req, res) => {
    try {
      const driverId = String(req.body?.driverId ?? '').trim();
      if (!driverId) {
        res.status(400).json({ ok: false, error: 'Missing driverId' });
        return;
      }

      const state = (await readInfoFile(dataRoot)) ?? {};
      let cloud = { ok: false };
      if (verifyLinkedWithCloud) {
        cloud = await verifyLinkedWithCloud(driverId);
      }
      const verified = cloud?.ok ? cloud : verifyLinkedDriverLocally(state, driverId);
      if (!verified?.ok) {
        res.status(403).json({
          ok: false,
          error: verified?.error ?? cloud?.error ?? 'Not linked to this bus',
        });
        return;
      }

      const session = createDriverSession(driverId);
      await saveSessionsToDisk(dataRoot);
      await setDriverLink(dataRoot, {
        driverId: session.driverId,
        linkedAt: Date.now(),
      });

      res.json({
        ok: true,
        token: session.token,
        plate:
          verified.plate ??
          cloud?.plate ??
          state.busProfile?.plateDisplay ??
          state.busProfile?.plate ??
          null,
        offline: Boolean(verified.offline),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

export function requireDriverAuthUnlessLocal(req, res, next) {
  if (req.method === 'GET') return next();
  if (isLocalRequest(req)) return next();
  const token = getDriverTokenFromRequest(req);
  if (isDriverSessionValid(token)) return next();
  res.status(403).json({
    ok: false,
    error: 'Not connected — enter the bus pair code on this phone',
    code: 'DRIVER_LOCKED',
  });
}
