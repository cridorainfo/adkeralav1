import { randomUUID, randomBytes, createHash } from 'crypto';
import { loadStore, saveStore, generatePairingCode, normalizePlate } from './store.js';
import { usePostgres, query } from './db/pool.js';
import { pgUpsertBusProfile } from './storePg.js';
import { pgEnsureUser, pgOwnerId, isValidUuid } from './usersPg.js';
import {
  pgUpsertEnrollment,
  pgGetEnrollment,
  pgFindEnrollmentByCode,
  pgListPendingEnrollments,
  pgClaimEnrollment,
  pgGetDeviceForInstall,
} from './fleetPg.js';

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
  if (usePostgres() && isValidUuid(id)) {
    await pgUpsertEnrollment({
      installId: id,
      fleetClaimCode: code,
      expiresAt: store.fleetEnrollments[id].expiresAt,
      appVersion,
    });
  }
  await saveStore();
  return { ok: true, installId: id, claimed: false, expiresAt: store.fleetEnrollments[id].expiresAt };
}

export async function getEnrollmentStatus(installId) {
  const id = String(installId ?? '').trim();
  if (!id) return { ok: false, error: 'Missing installId' };

  if (usePostgres() && isValidUuid(id)) {
    const enrollment = await pgGetEnrollment(id);
    if (!enrollment) {
      return { ok: true, claimed: false, registered: false };
    }

    if (enrollment.expiresAt && Date.now() > enrollment.expiresAt && !enrollment.claimed) {
      return { ok: true, claimed: false, registered: true, expired: true };
    }

    const device = await pgGetDeviceForInstall(id);
    if (enrollment.claimed && device?.pending_token) {
      const token = device.pending_token;
      await query(
        `UPDATE bus_devices SET pending_token = NULL, token_hash = $2 WHERE install_id = $1::uuid`,
        [id, hashToken(token)]
      );
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
      expired: Boolean(
        enrollment.expiresAt && Date.now() > enrollment.expiresAt && !enrollment.claimed
      ),
    };
  }

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
  let enrollment = null;

  if (!targetInstallId && usePostgres()) {
    enrollment = await pgFindEnrollmentByCode(code);
    if (enrollment) targetInstallId = enrollment.installId;
  }

  if (!targetInstallId) {
    for (const [id, row] of Object.entries(store.fleetEnrollments)) {
      if (row.fleetClaimCode === code && !row.claimed) {
        targetInstallId = id;
        enrollment = row;
        break;
      }
    }
  }

  if (!targetInstallId) {
    return { ok: false, error: 'Fleet code not found. Check the bus display and try again.' };
  }

  if (!enrollment) {
    if (usePostgres() && isValidUuid(targetInstallId)) {
      enrollment = await pgGetEnrollment(targetInstallId);
    }
    enrollment = enrollment ?? store.fleetEnrollments[targetInstallId];
  }
  if (!enrollment || enrollment.fleetClaimCode !== code) {
    return { ok: false, error: 'Invalid fleet code' };
  }
  if (!store.fleetEnrollments[targetInstallId]) {
    store.fleetEnrollments[targetInstallId] = { ...enrollment, installId: targetInstallId };
  }
  enrollment = store.fleetEnrollments[targetInstallId];
  if (enrollment.claimed) {
    return { ok: false, error: 'This bus is already claimed' };
  }
  if (enrollment.expiresAt && Date.now() > enrollment.expiresAt) {
    return { ok: false, error: 'Fleet code expired. Restart the bus PC to get a new code.' };
  }

  const busId = generateBusId();
  const deviceToken = generateDeviceToken();
  const pgOwner = pgOwnerId(ownerId);
  if (!store.busProfiles) store.busProfiles = {};
  store.busProfiles[busId] = {
    plate: plate ? normalizePlate(plate) : '',
    plateDisplay: plate ? String(plate).trim() : '',
    pairingCode: generatePairingCode(),
    linkedDriverId: null,
    linkedAt: null,
    ownerId: pgOwner ?? ownerId,
  };
  const profile = store.busProfiles[busId];

  enrollment.claimed = true;
  enrollment.busId = busId;
  enrollment.ownerId = pgOwner ?? ownerId;
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
    await pgEnsureUser(ownerId);
    await pgUpsertBusProfile(busId, { ...profile, ownerId: pgOwner });
    if (isValidUuid(targetInstallId)) {
      await pgClaimEnrollment({
        installId: targetInstallId,
        fleetClaimCode: code,
        busId,
        ownerId: pgOwner,
        expiresAt: enrollment.expiresAt,
        deviceTokenHash: hashToken(deviceToken),
        pendingToken: deviceToken,
      });
    }
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
  if (usePostgres()) {
    const rows = await pgListPendingEnrollments();
    return rows.filter((row) => !ownerId || !row.ownerId || row.ownerId === ownerId);
  }

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
