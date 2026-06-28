import { randomBytes } from 'crypto';
import { readInfoFile } from './dbApi.js';

const SESSION_MS = 12 * 60 * 60 * 1000;
const sessions = new Map();

export const DRIVER_TOKEN_HEADER = 'x-driver-token';

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
  const expiresAt = Date.now() + SESSION_MS;
  sessions.set(token, { expiresAt });
  return { token, expiresAt };
}

function normalizePairingCode(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}

/**
 * Driver phone unlock — pairing code (display) + admin OTP (cloud).
 * @param {import('express').Application} app
 * @param {{ dataRoot: string, verifyWithCloud: (pairingCode: string, otp: string) => Promise<object> }} options
 */
export function setupDriverAuth(app, { dataRoot, verifyWithCloud }) {
  app.get('/api/driver/unlock-status', (req, res) => {
    const token = getDriverTokenFromRequest(req);
    res.json({ ok: true, unlocked: isDriverSessionValid(token) });
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
