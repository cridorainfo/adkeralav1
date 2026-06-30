import path from 'path';
import { randomBytes } from 'crypto';
import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { getActiveRoute, getAllStops, getTripStartIndex } from '../src/store/busStore.js';
import { nextDriveRevision } from '../src/store/tripMerge.js';
import {
  atomicWriteTextFile,
  backupPathFor,
  durableWriteTextFile,
  readBestRecoverableFile,
} from './safeFileWrite.js';
import { archiveJsonContent, archiveRelativeLabel, readArchivedJson } from './stateArchive.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const HEARTBEAT_MS = 45 * 1000;
const SESSIONS_FILE = '.adkerala-driver-sessions.json';

export const DRIVER_TOKEN_HEADER = 'x-driver-token';

let sessions = new Map();
let cleanupTimer = null;
let dataRootRef = null;

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
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now > session.expiresAt) sessions.delete(token);
  }
}

export function hasActiveDriverSession() {
  pruneExpiredSessions();
  return sessions.size > 0;
}

export function isDriverSessionValid(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function createDriverSession(driverIdOverride = null) {
  const token = randomBytes(24).toString('hex');
  const driverId =
    driverIdOverride && String(driverIdOverride).trim()
      ? String(driverIdOverride).trim()
      : `phone-${token.slice(0, 12)}`;
  const expiresAt = Date.now() + SESSION_MS;
  sessions.set(token, { expiresAt, driverId, lastSeenAt: Date.now() });
  return { token, expiresAt, driverId };
}

async function touchSession(token) {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    await saveSessionsToDisk(dataRootRef);
    return false;
  }
  session.lastSeenAt = Date.now();
  session.expiresAt = Date.now() + SESSION_MS;
  await saveSessionsToDisk(dataRootRef);
  return true;
}

function normalizePairingCode(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

function normalizeDriverOtp(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 6);
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

/** Offline LAN unlock when bus has cached admin OTP from a prior cloud sync. */
function verifyDriverControlLocally(state, pairingCode, otp) {
  const localCode = normalizePairingCode(state.busProfile?.pairingCode);
  const code = normalizePairingCode(pairingCode);
  if (!localCode || code !== localCode) {
    return { ok: false, error: 'Pairing code does not match this bus' };
  }

  const submittedOtp = normalizeDriverOtp(otp);
  if (submittedOtp.length !== 6) {
    return { ok: false, error: 'Enter the 6-digit OTP from admin' };
  }

  const cachedOtp = normalizeDriverOtp(state.busProfile?.driverControlOtp);
  if (!cachedOtp) {
    return {
      ok: false,
      error:
        'Offline unlock unavailable — connect this bus to the internet once so it can cache the admin OTP.',
    };
  }

  if (submittedOtp !== cachedOtp) {
    return { ok: false, error: 'Invalid admin OTP' };
  }

  return {
    ok: true,
    offline: true,
    plate: state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
  };
}

function isLocalPhoneDriverId(driverId) {
  return Boolean(driverId && String(driverId).startsWith('phone-'));
}

async function setDriverLink(dataRoot, driverLink) {
  const current = (await readInfoFile(dataRoot)) ?? {};
  const pushAt = Date.now();
  let next = {
    ...current,
    driverLink,
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

async function clearLocalDriverLinkIfIdle(dataRoot) {
  if (hasActiveDriverSession()) return;
  const state = (await readInfoFile(dataRoot)) ?? {};
  if (!isLocalPhoneDriverId(state.driverLink?.driverId)) return;

  const linkedAt = state.driverLink?.linkedAt ?? 0;
  if (!linkedAt || Date.now() - linkedAt < SESSION_MS) {
    // Session file may be empty after reboot — keep link until expiry or explicit disconnect.
    return;
  }
  await setDriverLink(dataRoot, null);
}

function startSessionCleanup(dataRoot) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    clearLocalDriverLinkIfIdle(dataRoot).catch(() => {});
  }, HEARTBEAT_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
}

/**
 * Driver phone unlock — pairing code (display) + admin OTP (cloud).
 */
export function setupDriverAuth(app, { dataRoot, verifyWithCloud, verifyLinkedWithCloud }) {
  dataRootRef = dataRoot;
  loadSessionsFromDisk(dataRoot).then(() => {
    startSessionCleanup(dataRoot);
  });

  app.get('/api/driver/unlock-status', (req, res) => {
    const token = getDriverTokenFromRequest(req);
    res.json({ ok: true, unlocked: isDriverSessionValid(token) });
  });

  app.get('/api/driver/connected', async (_req, res) => {
    const state = (await readInfoFile(dataRoot)) ?? {};
    res.json({
      ok: true,
      connected: Boolean(state.driverLink?.driverId) || hasActiveDriverSession(),
    });
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
    await setDriverLink(dataRoot, null);
    res.json({ ok: true });
  });

  app.post('/api/driver/verify', async (req, res) => {
    try {
      const pairingCode = normalizePairingCode(req.body?.pairingCode);
      const otp = String(req.body?.otp ?? '').trim();

      if (!pairingCode || pairingCode.length !== 4) {
        res.status(400).json({ ok: false, error: 'Enter the 4-digit code from the bus screen' });
        return;
      }

      const state = (await readInfoFile(dataRoot)) ?? {};
      const localCode = normalizePairingCode(state.busProfile?.pairingCode);
      if (!localCode || pairingCode !== localCode) {
        res.status(403).json({ ok: false, error: 'Pairing code does not match this bus' });
        return;
      }

      const cloud = await verifyWithCloud(pairingCode, otp);
      const verified = cloud?.ok ? cloud : verifyDriverControlLocally(state, pairingCode, otp);
      if (!verified?.ok) {
        res.status(403).json({
          ok: false,
          error: verified?.error ?? cloud?.error ?? 'Verification failed',
        });
        return;
      }

      const session = createDriverSession();
      await saveSessionsToDisk(dataRoot);
      await setDriverLink(dataRoot, {
        driverId: session.driverId,
        linkedAt: Date.now(),
      });

      res.json({
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
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
        expiresAt: session.expiresAt,
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
    error: 'Driver unlock required — enter pairing code and admin OTP',
    code: 'DRIVER_LOCKED',
  });
}
