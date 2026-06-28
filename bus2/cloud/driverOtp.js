import { loadStore, saveStore } from './store.js';
import { usePostgres, query } from './db/pool.js';
import { pgEnsureUser } from './usersPg.js';

const PLATFORM_OWNER = 'platform';

export function normalizeDriverOtp(value) {
  return String(value ?? '')
    .replace(/\D/g, '')
    .slice(0, 6);
}

export function generateDriverOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function ownerKey(ownerId) {
  return ownerId && String(ownerId).trim() ? String(ownerId).trim() : PLATFORM_OWNER;
}

async function pgGetOwnerDriverOtp(ownerId) {
  if (!usePostgres()) return null;
  const key = ownerKey(ownerId);
  if (key === PLATFORM_OWNER) {
    const { rows } = await query(
      `SELECT value FROM platform_settings WHERE key = 'driver_control_otp' LIMIT 1`
    );
    const val = rows[0]?.value;
    if (val?.otp) return { otp: val.otp, updatedAt: val.updatedAt ?? Date.now() };
    return null;
  }
  await pgEnsureUser(key);
  const { rows } = await query(
    `SELECT driver_control_otp, driver_control_otp_updated_at FROM users WHERE id = $1`,
    [key]
  );
  const row = rows[0];
  if (!row?.driver_control_otp) return null;
  return { otp: row.driver_control_otp, updatedAt: Number(row.driver_control_otp_updated_at ?? 0) };
}

async function pgSetOwnerDriverOtp(ownerId, entry) {
  if (!usePostgres()) return;
  const key = ownerKey(ownerId);
  if (key === PLATFORM_OWNER) {
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ('driver_control_otp', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(entry)]
    );
    return;
  }
  await pgEnsureUser(key);
  await query(
    `UPDATE users SET driver_control_otp = $2, driver_control_otp_updated_at = $3 WHERE id = $1`,
    [key, entry.otp, entry.updatedAt]
  );
}

/** Fleet-wide driver OTP — created on first read, refreshed only when admin requests. */
export async function getOwnerDriverOtp(ownerId) {
  const key = ownerKey(ownerId);
  if (usePostgres()) {
    const existing = await pgGetOwnerDriverOtp(key);
    if (existing?.otp) return { ...existing, ownerId: key };
  }

  const store = await loadStore();
  if (!store.ownerDriverOtps) store.ownerDriverOtps = {};
  let entry = store.ownerDriverOtps[key];
  if (!entry?.otp) {
    entry = { otp: generateDriverOtp(), updatedAt: Date.now() };
    store.ownerDriverOtps[key] = entry;
    await saveStore();
    await pgSetOwnerDriverOtp(key, entry);
  }
  return { ...entry, ownerId: key };
}

export async function refreshOwnerDriverOtp(ownerId) {
  const key = ownerKey(ownerId);
  const entry = { otp: generateDriverOtp(), updatedAt: Date.now() };
  const store = await loadStore();
  if (!store.ownerDriverOtps) store.ownerDriverOtps = {};
  store.ownerDriverOtps[key] = entry;
  await saveStore();
  await pgSetOwnerDriverOtp(key, entry);
  return { ...entry, ownerId: key };
}

export async function verifyDriverControlForBus(busId, pairingCode, otp) {
  const { getBusProfile } = await import('./store.js');
  const profile = await getBusProfile(busId);
  if (!profile) return { ok: false, error: 'Bus not found' };

  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const expectedCode = String(profile.pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);

  if (!code || code !== expectedCode) {
    return { ok: false, error: 'Invalid pairing code for this bus' };
  }

  const submittedOtp = normalizeDriverOtp(otp);
  if (submittedOtp.length !== 6) {
    return { ok: false, error: 'Enter the 6-digit OTP from admin' };
  }

  const ownerId = profile.ownerId || PLATFORM_OWNER;
  const ownerOtp = await getOwnerDriverOtp(ownerId);
  if (submittedOtp !== ownerOtp.otp) {
    return { ok: false, error: 'Invalid admin OTP' };
  }

  return {
    ok: true,
    busId,
    plate: profile.plateDisplay || profile.plate || busId,
    ownerId,
  };
}
