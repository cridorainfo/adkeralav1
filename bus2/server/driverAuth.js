import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';

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

async function loadSessionsFromDisk(dataRoot) {
  try {
    const raw = await fs.readFile(sessionsPath(dataRoot), 'utf8');
    const json = JSON.parse(raw);
    sessions = new Map(Object.entries(json.sessions ?? {}));
  } catch {
    sessions = new Map();
  }
  pruneExpiredSessions();
}

async function saveSessionsToDisk(dataRoot) {
  try {
    const obj = { sessions: Object.fromEntries(sessions) };
    await fs.writeFile(sessionsPath(dataRoot), JSON.stringify(obj), 'utf8');
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

function createDriverSession() {
  const token = randomBytes(24).toString('hex');
  const driverId = `phone-${token.slice(0, 12)}`;
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

function isLocalPhoneDriverId(driverId) {
  return Boolean(driverId && String(driverId).startsWith('phone-'));
}

async function setDriverLink(dataRoot, driverLink) {
  const current = (await readInfoFile(dataRoot)) ?? {};
  await writeInfoFileSerialized(dataRoot, {
    ...current,
    driverLink,
    savedAt: Date.now(),
  });
}

async function clearLocalDriverLinkIfIdle(dataRoot) {
  if (hasActiveDriverSession()) return;
  const state = (await readInfoFile(dataRoot)) ?? {};
  if (isLocalPhoneDriverId(state.driverLink?.driverId)) {
    await setDriverLink(dataRoot, null);
  }
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
export function setupDriverAuth(app, { dataRoot, verifyWithCloud }) {
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
      if (!state.driverLink?.driverId) {
        await setDriverLink(dataRoot, { driverId: session.driverId, linkedAt: Date.now() });
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/driver/disconnect', async (req, res) => {
    const token = getDriverTokenFromRequest(req);
    if (token) sessions.delete(token);
    await saveSessionsToDisk(dataRoot);
    await clearLocalDriverLinkIfIdle(dataRoot);
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
      if (!cloud?.ok) {
        res.status(403).json({ ok: false, error: cloud?.error ?? 'Verification failed' });
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
        plate: cloud.plate ?? state.busProfile?.plateDisplay ?? state.busProfile?.plate ?? null,
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
