import { randomUUID, randomBytes, createHash } from 'crypto';
import { loadStore, saveStore, generatePairingCode, normalizePlate } from './store.js';
import { usePostgres, query } from './db/pool.js';
import { pgUpsertBusProfile } from './storePg.js';

const ENROLL_TTL_MS = 30 * 60 * 1000;
const ONLINE_THRESHOLD_MS = Number(process.env.ADKERALA_ONLINE_MS ?? 20000);

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function generateDeviceToken() {
  return randomBytes(32).toString('hex');
}

function generateBusId() {
  return `bus-${randomUUID().slice(0, 8)}`;
}

function ensureFleetStore(store) {
  if (!store.fleetEnrollments) store.fleetEnrollments = {};
  if (!store.busDevices) store.busDevices = {};
  return store;
}

export async function enrollDevice({ installId, fleetClaimCode, appVersion = null }) {
  const id = String(installId ?? '').trim();
  const code = String(fleetClaimCode ?? '').replace(/\D/g, '');
  if (!id || code.length !== 6) {
    return { ok: false, error: 'installId and 6-digit fleetClaimCode required' };
  }

  const store = await loadStore();
  ensureFleetStore(store);

  const existing = store.fleetEnrollments[id];
  if (existing?.claimed && existing.busId) {
    const device = store.busDevices[id];
    if (device?.pendingToken) {
      return {
        ok: true,
        installId: id,
        claimed: true,
        busId: existing.busId,
        pendingToken: true,
      };
    }
    return { ok: true, installId: id, claimed: true, busId: existing.busId };
  }

  store.fleetEnrollments[id] = {
    installId: id,
    fleetClaimCode: code,
    expiresAt: Date.now() + ENROLL_TTL_MS,
    claimed: false,
    busId: null,
    ownerId: null,
    appVersion,
    updatedAt: Date.now(),
  };
  await saveStore();
  return { ok: true, installId: id, claimed: false, expiresAt: store.fleetEnrollments[id].expiresAt };
}

export async function getEnrollmentStatus(installId) {
  const id = String(installId ?? '').trim();
  if (!id) return { ok: false, error: 'Missing installId' };

  const store = await loadStore();
  ensureFleetStore(store);
  const enrollment = store.fleetEnrollments[id];
  if (!enrollment) {
    return { ok: true, claimed: false, registered: false };
  }

  if (enrollment.expiresAt && Date.now() > enrollment.expiresAt && !enrollment.claimed) {
    return { ok: true, claimed: false, registered: true, expired: true };
  }

  const device = store.busDevices[id];
  if (enrollment.claimed && device?.pendingToken) {
    const token = device.pendingToken;
    delete device.pendingToken;
    device.tokenHash = hashToken(token);
    device.claimedAt = Date.now();
    await saveStore();
    return {
      ok: true,
      claimed: true,
      busId: enrollment.busId,
      deviceToken: token,
    };
  }

  return {
    ok: true,
    claimed: Boolean(enrollment.claimed),
    busId: enrollment.busId ?? null,
    registered: true,
    expired: Boolean(enrollment.expiresAt && Date.now() > enrollment.expiresAt && !enrollment.claimed),
  };
}

export async function claimBusByCode({ fleetClaimCode, plate, ownerId, installId = null }) {
  const code = String(fleetClaimCode ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { ok: false, error: 'Enter the 6-digit fleet code from the bus display' };
  if (!ownerId) return { ok: false, error: 'Owner required' };

  const store = await loadStore();
  ensureFleetStore(store);

  let targetInstallId = installId ? String(installId).trim() : null;
  if (!targetInstallId) {
    for (const [id, row] of Object.entries(store.fleetEnrollments)) {
      if (row.fleetClaimCode === code && !row.claimed) {
        targetInstallId = id;
        break;
      }
    }
  }

  if (!targetInstallId) {
    return { ok: false, error: 'Fleet code not found. Check the bus display and try again.' };
  }

  const enrollment = store.fleetEnrollments[targetInstallId];
  if (!enrollment || enrollment.fleetClaimCode !== code) {
    return { ok: false, error: 'Invalid fleet code' };
  }
  if (enrollment.claimed) {
    return { ok: false, error: 'This bus is already claimed' };
  }
  if (enrollment.expiresAt && Date.now() > enrollment.expiresAt) {
    return { ok: false, error: 'Fleet code expired. Restart the bus PC to get a new code.' };
  }

  const busId = generateBusId();
  const deviceToken = generateDeviceToken();
  if (!store.busProfiles) store.busProfiles = {};
  store.busProfiles[busId] = {
    plate: plate ? normalizePlate(plate) : '',
    plateDisplay: plate ? String(plate).trim() : '',
    pairingCode: generatePairingCode(),
    linkedDriverId: null,
    linkedAt: null,
    ownerId,
  };
  const profile = store.busProfiles[busId];

  enrollment.claimed = true;
  enrollment.busId = busId;
  enrollment.ownerId = ownerId;
  enrollment.claimedAt = Date.now();

  store.busDevices[targetInstallId] = {
    installId: targetInstallId,
    busId,
    tokenHash: hashToken(deviceToken),
    pendingToken: deviceToken,
    claimedAt: Date.now(),
    revokedAt: null,
  };

  if (usePostgres()) {
    await pgUpsertBusProfile(busId, profile);
    await query(
      `INSERT INTO fleet_enrollments (install_id, fleet_claim_code, expires_at, claimed, bus_id, owner_id, updated_at, claimed_at)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, $6)
       ON CONFLICT (install_id) DO UPDATE SET claimed = TRUE, bus_id = EXCLUDED.bus_id, owner_id = EXCLUDED.owner_id, claimed_at = EXCLUDED.claimed_at`,
      [targetInstallId, code, enrollment.expiresAt, busId, ownerId, Date.now()]
    );
    await query(
      `INSERT INTO bus_devices (install_id, bus_id, token_hash, pending_token, claimed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (install_id) DO UPDATE SET bus_id = EXCLUDED.bus_id, token_hash = EXCLUDED.token_hash, pending_token = EXCLUDED.pending_token`,
      [targetInstallId, busId, hashToken(deviceToken), deviceToken, Date.now()]
    );
  }

  await saveStore();
  return {
    ok: true,
    busId,
    installId: targetInstallId,
    profile,
    deviceToken,
  };
}

export async function listPendingEnrollments({ ownerId = null } = {}) {
  const store = await loadStore();
  ensureFleetStore(store);
  const rows = [];
  for (const row of Object.values(store.fleetEnrollments)) {
    if (row.claimed) continue;
    if (row.expiresAt && Date.now() > row.expiresAt) continue;
    if (ownerId && row.ownerId && row.ownerId !== ownerId) continue;
    rows.push({
      installId: row.installId,
      fleetClaimCode: row.fleetClaimCode,
      expiresAt: row.expiresAt,
      updatedAt: row.updatedAt,
      appVersion: row.appVersion ?? null,
    });
  }
  return rows;
}

export async function revokeBusDevice(busId, { ownerId = null, admin = false } = {}) {
  const store = await loadStore();
  ensureFleetStore(store);
  const profile = store.busProfiles?.[busId];
  if (!profile) return { ok: false, error: 'Bus not found' };
  if (!admin && ownerId && profile.ownerId !== ownerId) {
    return { ok: false, error: 'Forbidden' };
  }

  for (const [installId, device] of Object.entries(store.busDevices)) {
    if (device.busId === busId) {
      device.revokedAt = Date.now();
      device.tokenHash = null;
      device.pendingToken = null;
    }
  }

  await saveStore();
  return { ok: true, busId };
}

export async function verifyBusDeviceToken(busId, token) {
  if (!token) return false;
  const hash = hashToken(token);
  if (usePostgres()) {
    const { rows } = await query(
      `SELECT 1 FROM bus_devices WHERE bus_id = $1 AND token_hash = $2 AND revoked_at IS NULL`,
      [busId, hash]
    );
    return rows.length > 0;
  }
  const store = await loadStore();
  ensureFleetStore(store);
  for (const device of Object.values(store.busDevices)) {
    if (device.busId === busId && device.tokenHash === hash && !device.revokedAt) {
      return true;
    }
  }
  return false;
}

export async function findBusIdByDeviceToken(token) {
  if (!token) return null;
  const hash = hashToken(token);
  if (usePostgres()) {
    const { rows } = await query(
      `SELECT bus_id FROM bus_devices WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1`,
      [hash]
    );
    return rows[0]?.bus_id ?? null;
  }
  const store = await loadStore();
  ensureFleetStore(store);
  for (const device of Object.values(store.busDevices)) {
    if (device.tokenHash === hash && !device.revokedAt) {
      return device.busId;
    }
  }
  return null;
}
