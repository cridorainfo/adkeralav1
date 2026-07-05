import { query, usePostgres } from './db/pool.js';

function rowToEnrollment(row) {
  if (!row) return null;
  return {
    installId: String(row.install_id),
    fleetClaimCode: row.fleet_claim_code,
    expiresAt: Number(row.expires_at),
    claimed: Boolean(row.claimed),
    busId: row.bus_id ?? null,
    ownerId: row.owner_id ?? null,
    appVersion: row.app_version ?? null,
    updatedAt: Number(row.updated_at),
    claimedAt: row.claimed_at ? Number(row.claimed_at) : null,
  };
}

export async function pgUpsertEnrollment({ installId, fleetClaimCode, expiresAt, appVersion = null }) {
  const now = Date.now();
  await query(
    `INSERT INTO fleet_enrollments (install_id, fleet_claim_code, expires_at, claimed, app_version, updated_at)
     VALUES ($1::uuid, $2, $3, FALSE, $4, $5)
     ON CONFLICT (install_id) DO UPDATE SET
       fleet_claim_code = EXCLUDED.fleet_claim_code,
       expires_at = EXCLUDED.expires_at,
       app_version = EXCLUDED.app_version,
       updated_at = EXCLUDED.updated_at
     WHERE fleet_enrollments.claimed = FALSE`,
    [installId, fleetClaimCode, expiresAt, appVersion, now]
  );
}

export async function pgGetEnrollment(installId) {
  const { rows } = await query(
    `SELECT install_id, fleet_claim_code, expires_at, claimed, bus_id, owner_id, app_version, updated_at, claimed_at
     FROM fleet_enrollments WHERE install_id = $1::uuid`,
    [installId]
  );
  return rowToEnrollment(rows[0]);
}

export async function pgFindEnrollmentByCode(code) {
  const { rows } = await query(
    `SELECT install_id, fleet_claim_code, expires_at, claimed, bus_id, owner_id, app_version, updated_at, claimed_at
     FROM fleet_enrollments
     WHERE fleet_claim_code = $1 AND claimed = FALSE
     ORDER BY updated_at DESC
     LIMIT 1`,
    [code]
  );
  return rowToEnrollment(rows[0]);
}

export async function pgListPendingEnrollments(activeSince = 0) {
  const now = Date.now();
  const { rows } = await query(
    `SELECT install_id, fleet_claim_code, expires_at, updated_at, app_version
     FROM fleet_enrollments
     WHERE claimed = FALSE
       AND expires_at > $1
       AND updated_at > $2
     ORDER BY updated_at DESC`,
    [now, activeSince]
  );
  return rows.map((row) => ({
    installId: String(row.install_id),
    fleetClaimCode: row.fleet_claim_code,
    expiresAt: Number(row.expires_at),
    updatedAt: Number(row.updated_at),
    appVersion: row.app_version ?? null,
  }));
}

/** Drop expired unclaimed rows (old app starts / stale codes). */
export async function pgCleanupExpiredEnrollments() {
  const now = Date.now();
  await query(`DELETE FROM fleet_enrollments WHERE claimed = FALSE AND expires_at <= $1`, [now]);
}

/** One fleet code → one live enrollment (latest install wins when code moves). */
export async function pgSupersedeEnrollmentByCode(fleetClaimCode, keepInstallId) {
  await query(
    `DELETE FROM fleet_enrollments
     WHERE claimed = FALSE
       AND fleet_claim_code = $1
       AND install_id <> $2::uuid`,
    [fleetClaimCode, keepInstallId]
  );
}

export async function pgClaimEnrollment({
  installId,
  fleetClaimCode,
  busId,
  ownerId,
  expiresAt,
  deviceTokenHash,
  pendingToken,
}) {
  const now = Date.now();
  await query(
    `INSERT INTO fleet_enrollments (install_id, fleet_claim_code, expires_at, claimed, bus_id, owner_id, updated_at, claimed_at)
     VALUES ($1::uuid, $2, $3, TRUE, $4, $5, $6, $6)
     ON CONFLICT (install_id) DO UPDATE SET
       claimed = TRUE,
       bus_id = EXCLUDED.bus_id,
       owner_id = EXCLUDED.owner_id,
       claimed_at = EXCLUDED.claimed_at,
       updated_at = EXCLUDED.updated_at`,
    [installId, fleetClaimCode, expiresAt, busId, ownerId, now]
  );
  await query(
    `INSERT INTO bus_devices (install_id, bus_id, token_hash, pending_token, claimed_at)
     VALUES ($1::uuid, $2, $3, $4, $5)
     ON CONFLICT (install_id) DO UPDATE SET
       bus_id = EXCLUDED.bus_id,
       token_hash = EXCLUDED.token_hash,
       pending_token = EXCLUDED.pending_token,
       claimed_at = EXCLUDED.claimed_at,
       revoked_at = NULL`,
    [installId, busId, deviceTokenHash, pendingToken, now]
  );
}

export async function pgGetDeviceForInstall(installId) {
  const { rows } = await query(
    `SELECT install_id, bus_id, token_hash, pending_token, claimed_at, revoked_at
     FROM bus_devices WHERE install_id = $1::uuid`,
    [installId]
  );
  return rows[0] ?? null;
}

export async function pgRevokeDevicesForBus(busId, { exceptInstallId = null } = {}) {
  const now = Date.now();
  if (exceptInstallId) {
    await query(
      `UPDATE bus_devices SET revoked_at = $2, token_hash = NULL, pending_token = NULL
       WHERE bus_id = $1 AND install_id <> $3::uuid`,
      [busId, now, exceptInstallId]
    );
    return;
  }
  await query(
    `UPDATE bus_devices SET revoked_at = $2, token_hash = NULL, pending_token = NULL WHERE bus_id = $1`,
    [busId, now]
  );
}

const FLEET_ENROLL_TTL_MS = 30 * 60 * 1000;

export async function pgResetEnrollmentsForBus(busId) {
  const now = Date.now();
  await query(
    `UPDATE fleet_enrollments
     SET claimed = FALSE,
         bus_id = NULL,
         owner_id = NULL,
         expires_at = $2,
         updated_at = $2
     WHERE bus_id = $1`,
    [busId, now + FLEET_ENROLL_TTL_MS]
  );
}

export function pgUsesFleet() {
  return usePostgres();
}
