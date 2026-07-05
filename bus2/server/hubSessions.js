import path from 'path';
import { randomBytes } from 'crypto';
import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { notifyStateChanged } from './stateEvents.js';
import { generatePairingCode, getDriverVisibleRoutes } from '../src/store/busStore.js';
import {
  atomicWriteTextFile,
  backupPathFor,
  durableWriteTextFile,
  readBestRecoverableFile,
} from './safeFileWrite.js';
import { archiveJsonContent, archiveRelativeLabel, readArchivedJson } from './stateArchive.js';

const SESSIONS_FILE = '.adkerala-hub-sessions.json';
const LEGACY_SESSIONS_FILE = '.adkerala-driver-sessions.json';
const SESSION_SAVE_INTERVAL_MS = 120_000;
const CONNECT_RATE_LIMIT = 8;
const CONNECT_RATE_WINDOW_MS = 60_000;

export const HUB_TOKEN_HEADER = 'x-hub-token';
/** @deprecated accept legacy header during transition */
const LEGACY_TOKEN_HEADER = 'x-driver-token';

let sessions = new Map();
/** @type {Map<string, string>} deviceId -> token */
let deviceTokens = new Map();
let dataRootRef = null;
let sessionsReadyPromise = null;
let lastSessionSaveAt = 0;
const connectAttempts = new Map();

function sessionsPath(dataRoot) {
  return path.join(dataRoot, SESSIONS_FILE);
}

function legacySessionsPath(dataRoot) {
  return path.join(dataRoot, LEGACY_SESSIONS_FILE);
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

function rebuildDeviceIndex() {
  deviceTokens = new Map();
  for (const [token, session] of sessions) {
    const deviceId = String(session?.deviceId ?? '').trim();
    if (deviceId) deviceTokens.set(deviceId, token);
  }
}

function loadSessionsFromJson(json) {
  sessions = new Map(Object.entries(json.sessions ?? {}));
  rebuildDeviceIndex();
}

async function loadSessionsFromDisk(dataRoot) {
  const file = sessionsPath(dataRoot);
  const legacyFile = legacySessionsPath(dataRoot);

  try {
    const localBest = await readBestRecoverableFile(file, {
      validate: isValidSessionsRaw,
      score: sessionsScore,
    });
    const legacyBest = await readBestRecoverableFile(legacyFile, {
      validate: isValidSessionsRaw,
      score: sessionsScore,
    });
    const archiveBest = await readArchivedJson(dataRoot, 'sessions', {
      validate: isValidSessionsRaw,
    });

    let best = localBest;
    if (legacyBest && (!best || legacyBest.score >= best.score)) {
      best = legacyBest;
    }
    if (archiveBest) {
      const archiveScore = sessionsScore(archiveBest.raw);
      if (!best || archiveScore >= best.score) {
        best = { raw: archiveBest.raw, sourcePath: archiveBest.sourcePath, score: archiveScore };
      }
    }

    if (!best) {
      sessions = new Map();
      deviceTokens = new Map();
      return;
    }

    loadSessionsFromJson(JSON.parse(best.raw));

    if (best.sourcePath !== file) {
      console.warn(
        `AdKerala: recovered hub sessions from ${archiveRelativeLabel(best.sourcePath, dataRoot)}`
      );
      await saveSessionsToDisk(dataRoot);
    }
  } catch {
    sessions = new Map();
    deviceTokens = new Map();
  }
}

async function saveSessionsToDisk(dataRoot) {
  try {
    const file = sessionsPath(dataRoot);
    const obj = { sessions: Object.fromEntries(sessions) };
    const content = JSON.stringify(obj);
    await archiveJsonContent(dataRoot, 'sessions', content);
    await durableWriteTextFile(file, content);
    await atomicWriteTextFile(backupPathFor(file), content).catch(() => {});
    lastSessionSaveAt = Date.now();
  } catch {
    /* ignore */
  }
}

export function getHubTokenFromRequest(req) {
  return String(
    req.headers[HUB_TOKEN_HEADER] ??
      req.headers[LEGACY_TOKEN_HEADER] ??
      req.query?.hubToken ??
      req.query?.driverToken ??
      ''
  ).trim();
}

export function isLocalRequest(req) {
  const ip = req.socket?.remoteAddress ?? '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  );
}

export function isHubSessionValid(token) {
  if (!token) return false;
  return sessions.has(token);
}

export function getConnectedDeviceCount() {
  return sessions.size;
}

export function hasActiveHubSession() {
  return sessions.size > 0;
}

export async function initHubSessions(dataRoot) {
  dataRootRef = dataRoot;
  if (!sessionsReadyPromise) {
    sessionsReadyPromise = loadSessionsFromDisk(dataRoot)
      .then(async () => {
        await restoreDriverLinkFromSessions(dataRoot);
        await refreshConnectedDeviceCountInState(dataRoot);
      })
      .catch((err) => {
        sessionsReadyPromise = null;
        throw err;
      });
  }
  return sessionsReadyPromise;
}

function whenSessionsReady() {
  if (!dataRootRef) return Promise.resolve();
  return initHubSessions(dataRootRef);
}

export function readDevicesDisconnectAt(state = {}) {
  return (
    state.busProfile?.devicesDisconnectLastApplied ??
    state.busProfile?.devicesDisconnectAt ??
    null
  );
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
  const next = {
    ...current,
    driverLink,
    connectedDeviceCount: getConnectedDeviceCount(),
    savedAt: pushAt,
    lastCloudPushAt: Math.max(current.lastCloudPushAt ?? 0, pushAt),
  };

  await writeInfoFileSerialized(dataRoot, next, { source: 'driver-link' });
}

async function restoreDriverLinkFromSessions(dataRoot) {
  if (sessions.size === 0) return;
  const state = (await readInfoFile(dataRoot)) ?? {};
  if (state.driverLink?.driverId) return;

  const first = sessions.values().next().value;
  if (!first?.driverId) return;

  await setDriverLink(dataRoot, { driverId: first.driverId, linkedAt: Date.now() });
}

function normalizePairingCode(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

function normalizeDeviceId(value) {
  return String(value ?? '').trim().slice(0, 64);
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

function createHubSession(deviceId, driverIdOverride = null) {
  const token = randomBytes(24).toString('hex');
  const driverId =
    driverIdOverride && String(driverIdOverride).trim()
      ? String(driverIdOverride).trim()
      : `phone-${token.slice(0, 12)}`;
  const session = { driverId, deviceId: deviceId || null, lastSeenAt: Date.now() };
  sessions.set(token, session);
  if (deviceId) deviceTokens.set(deviceId, token);
  lastSessionSaveAt = 0;
  return { token, driverId, deviceId };
}

async function touchSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  session.lastSeenAt = Date.now();
  const now = Date.now();
  if (now - lastSessionSaveAt >= SESSION_SAVE_INTERVAL_MS) {
    lastSessionSaveAt = now;
    await saveSessionsToDisk(dataRootRef);
  }
  return true;
}

/** Idempotent LAN pair — same deviceId reuses token when pair code matches. */
async function pairWithCode(dataRoot, pairingCode, deviceId = '') {
  const code = normalizePairingCode(pairingCode);
  if (!code || code.length !== 4) {
    return { ok: false, status: 400, error: 'Enter the 4-digit code from the bus screen' };
  }

  const normalizedDeviceId = normalizeDeviceId(deviceId);
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

  if (normalizedDeviceId) {
    const existingToken = deviceTokens.get(normalizedDeviceId);
    if (existingToken && sessions.has(existingToken)) {
      await touchSession(existingToken);
      const session = sessions.get(existingToken);
      return {
        ok: true,
        token: existingToken,
        deviceId: normalizedDeviceId,
        plate: state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
        hubRevision: state.driveRevision ?? 0,
        devicesDisconnectAt: readDevicesDisconnectAt(state),
        connectedDeviceCount: getConnectedDeviceCount(),
        reused: true,
      };
    }
  }

  const session = createHubSession(normalizedDeviceId);
  await saveSessionsToDisk(dataRoot);
  await setDriverLink(dataRoot, {
    driverId: session.driverId,
    linkedAt: Date.now(),
  });

  const fresh = (await readInfoFile(dataRoot)) ?? {};

  return {
    ok: true,
    token: session.token,
    deviceId: normalizedDeviceId || session.deviceId,
    plate: state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
    hubRevision: fresh.driveRevision ?? 0,
    devicesDisconnectAt: readDevicesDisconnectAt(fresh),
    connectedDeviceCount: getConnectedDeviceCount(),
    reused: false,
  };
}

export async function clearHubSessionsForDriver(dataRoot, driverId) {
  const id = String(driverId ?? '').trim();
  if (!id) return;
  let removed = false;
  for (const [token, session] of sessions) {
    if (session.driverId === id) {
      if (session.deviceId) deviceTokens.delete(session.deviceId);
      sessions.delete(token);
      removed = true;
    }
  }
  if (removed) {
    await saveSessionsToDisk(dataRoot ?? dataRootRef);
    await refreshConnectedDeviceCountInState(dataRoot ?? dataRootRef);
  }
}

export async function clearAllHubSessions(dataRoot) {
  if (sessions.size === 0) return false;
  sessions.clear();
  deviceTokens.clear();
  await saveSessionsToDisk(dataRoot ?? dataRootRef);
  await refreshConnectedDeviceCountInState(dataRoot ?? dataRootRef);
  return true;
}

/** @deprecated alias for cloudSync */
export const clearAllDriverSessions = clearAllHubSessions;
export const clearDriverSessionsForDriver = clearHubSessionsForDriver;

export async function disconnectAllDrivers(dataRoot, options = {}) {
  const root = dataRoot ?? dataRootRef;
  if (!root) return { ok: false, error: 'Missing data root' };

  const disconnectAt =
    typeof options === 'string' ? options : (options.disconnectAt ?? null);
  const rotatePairingCode =
    typeof options === 'string' ? false : options.rotatePairingCode !== false;
  const pairingCodeOverride =
    typeof options === 'string' ? null : (options.pairingCode ?? null);

  sessions.clear();
  deviceTokens.clear();
  await saveSessionsToDisk(root);

  const stamp = disconnectAt ?? new Date().toISOString();
  const current = (await readInfoFile(root)) ?? {};
  const pushAt = Date.now();
  const nextPairingCode = rotatePairingCode
    ? pairingCodeOverride || generatePairingCode()
    : current.busProfile?.pairingCode ?? '';

  const next = {
    ...current,
    driverLink: null,
    connectedDeviceCount: 0,
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

export function resetHubSessionsForTests() {
  sessions = new Map();
  deviceTokens = new Map();
  dataRootRef = null;
  sessionsReadyPromise = null;
  lastSessionSaveAt = 0;
  connectAttempts.clear();
}

export function normalizeClientState(state = {}) {
  const visible = getDriverVisibleRoutes(state);
  if (!visible.length) return state;
  const activeOk = visible.some((r) => r.id === state.activeRouteId);
  if (activeOk) return state;
  return { ...state, activeRouteId: visible[0].id };
}

export function setupHubSessions(app, { dataRoot }) {
  dataRootRef = dataRoot;
  connectAttempts.clear();

  app.get('/api/hub/status', async (req, res) => {
    await whenSessionsReady();
    const token = getHubTokenFromRequest(req);
    const connected = isHubSessionValid(token);
    const state = normalizeClientState((await readInfoFile(dataRoot)) ?? {});
    res.json({
      ok: true,
      connected,
      plate: connected
        ? state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null
        : null,
      hubRevision: state.driveRevision ?? 0,
      devicesDisconnectAt: readDevicesDisconnectAt(state),
      connectedDeviceCount: getConnectedDeviceCount(),
    });
  });

  app.post('/api/hub/pair', async (req, res) => {
    try {
      await whenSessionsReady();
      const result = await pairWithCode(
        dataRoot,
        req.body?.pairingCode ?? req.body?.code,
        req.body?.deviceId
      );
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

  app.post('/api/hub/ping', async (req, res) => {
    await whenSessionsReady();
    const token = getHubTokenFromRequest(req);
    if (!(await touchSession(token))) {
      res.json({ ok: false, stale: true });
      return;
    }
    const session = sessions.get(token);
    if (session?.driverId) {
      const state = (await readInfoFile(dataRoot)) ?? {};
      if (state.driverLink?.driverId !== session.driverId) {
        await setDriverLink(dataRoot, { driverId: session.driverId, linkedAt: Date.now() });
      }
    }
    await refreshConnectedDeviceCountInState(dataRoot);
    const state = normalizeClientState((await readInfoFile(dataRoot)) ?? {});
    res.json({
      ok: true,
      hubRevision: state.driveRevision ?? 0,
      devicesDisconnectAt: readDevicesDisconnectAt(state),
    });
  });

  app.post('/api/hub/disconnect', async (req, res) => {
    await whenSessionsReady();
    const token = getHubTokenFromRequest(req);
    if (token) {
      const session = sessions.get(token);
      if (session?.deviceId) deviceTokens.delete(session.deviceId);
      sessions.delete(token);
    }
    await saveSessionsToDisk(dataRoot);
    if (!hasActiveHubSession()) {
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

  app.post('/api/hub/disconnect-all', async (req, res) => {
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

  app.get('/api/hub/devices', async (_req, res) => {
    await whenSessionsReady();
    res.json({
      ok: true,
      connected: sessions.size > 0,
      connectedDeviceCount: sessions.size,
    });
  });

  app.get('/api/driver/routes', async (_req, res) => {
    const state = normalizeClientState((await readInfoFile(dataRoot)) ?? {});
    const routes = getDriverVisibleRoutes(state);
    res.json({
      ok: true,
      routes,
      activeRouteId: state.activeRouteId ?? null,
      assignedRouteIds: state.busProfile?.assignedRouteIds ?? [],
    });
  });
}

export function requireHubAuthUnlessLocal(req, res, next) {
  if (req.method === 'GET') return next();
  if (isLocalRequest(req)) return next();
  whenSessionsReady()
    .then(() => {
      const token = getHubTokenFromRequest(req);
      if (isHubSessionValid(token)) return next();
      res.status(403).json({
        ok: false,
        error: 'Not connected — enter the bus pair code on this phone',
        code: 'HUB_LOCKED',
      });
    })
    .catch(() => {
      res.status(503).json({
        ok: false,
        error: 'Bus is starting — try again in a moment',
        code: 'HUB_BOOT',
      });
    });
}

/** @deprecated */
export const requireDriverAuthUnlessLocal = requireHubAuthUnlessLocal;
export const setupDriverAuth = setupHubSessions;
export const getDriverTokenFromRequest = getHubTokenFromRequest;
export const isDriverSessionValid = isHubSessionValid;
export const hasActiveDriverSession = hasActiveHubSession;
export const DRIVER_TOKEN_HEADER = HUB_TOKEN_HEADER;
