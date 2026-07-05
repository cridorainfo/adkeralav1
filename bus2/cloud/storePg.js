import { randomUUID } from 'crypto';
import { query } from './db/pool.js';

const FULL_STATE_INTERVAL_MS = Number(process.env.ADKERALA_FULL_STATE_INTERVAL_MS ?? 60000);
const ONLINE_MS = Number(process.env.ADKERALA_ONLINE_MS ?? 20000);

const telemetryStateCache = new Map();

export async function pgWarmUp() {
  /* migrations run separately */
}

export async function pgPatchDriverLocation(busId, driverLocation) {
  const now = Date.now();
  const lat = driverLocation.lat ?? null;
  const lng = driverLocation.lng ?? null;
  const existing = await pgGetBus(busId);
  const existingLoc = existing?.telemetry?.driverLocation;
  if ((existingLoc?.at ?? 0) > (driverLocation.at ?? 0) && existingLoc?.lat != null) {
    return existing;
  }

  const telemetry = { ...(existing?.telemetry ?? {}), driverLocation };

  if (existing) {
    await query(
      `UPDATE bus_telemetry SET telemetry = $2, lat = $3, lng = $4, updated_at = $5 WHERE bus_id = $1`,
      [busId, JSON.stringify(telemetry), lat, lng, now]
    );
  } else {
    await query(
      `INSERT INTO bus_telemetry (bus_id, telemetry, state, lat, lng, updated_at, full_state_at)
       VALUES ($1, $2, '{}', $3, $4, $5, 0)`,
      [busId, JSON.stringify(telemetry), lat, lng, now]
    );
  }

  if (lat != null && lng != null) {
    await query(
      `INSERT INTO bus_location_history (bus_id, lat, lng, recorded_at) VALUES ($1, $2, $3, $4)`,
      [busId, lat, lng, now]
    );
  }

  return pgGetBus(busId);
}

export async function pgUpsertBusTelemetry(busId, { telemetry, state, displaySnapshot }) {
  const now = Date.now();
  const lat = telemetry?.driverLocation?.lat ?? null;
  const lng = telemetry?.driverLocation?.lng ?? null;
  const routeId = telemetry?.activeRouteId ?? null;
  const stopIndex = telemetry?.currentStopIndex ?? 0;
  const appVersion = telemetry?.appVersion ?? null;

  const cached = telemetryStateCache.get(busId) ?? { lastFullStateAt: 0 };
  const stateChanged = JSON.stringify(state) !== cached.stateJson;
  const storeFullState =
    stateChanged || now - cached.lastFullStateAt >= FULL_STATE_INTERVAL_MS;

  if (storeFullState) {
    cached.lastFullStateAt = now;
    cached.stateJson = JSON.stringify(state);
    telemetryStateCache.set(busId, cached);

    await query(
      `INSERT INTO bus_telemetry (bus_id, telemetry, state, display_snapshot, lat, lng, route_id, stop_index, app_version, updated_at, full_state_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (bus_id) DO UPDATE SET
         telemetry = EXCLUDED.telemetry,
         state = EXCLUDED.state,
         display_snapshot = EXCLUDED.display_snapshot,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         route_id = EXCLUDED.route_id,
         stop_index = EXCLUDED.stop_index,
         app_version = EXCLUDED.app_version,
         updated_at = EXCLUDED.updated_at,
         full_state_at = EXCLUDED.full_state_at`,
      [
        busId,
        JSON.stringify(telemetry ?? {}),
        JSON.stringify(state ?? {}),
        displaySnapshot ? JSON.stringify(displaySnapshot) : null,
        lat,
        lng,
        routeId,
        stopIndex,
        appVersion,
        now,
      ]
    );
  } else {
    await query(
      `INSERT INTO bus_telemetry (bus_id, telemetry, state, display_snapshot, lat, lng, route_id, stop_index, app_version, updated_at, full_state_at)
       VALUES ($1, $2, '{}', $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (bus_id) DO UPDATE SET
         telemetry = EXCLUDED.telemetry,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         route_id = EXCLUDED.route_id,
         stop_index = EXCLUDED.stop_index,
         app_version = EXCLUDED.app_version,
         updated_at = EXCLUDED.updated_at`,
      [
        busId,
        JSON.stringify(telemetry ?? {}),
        displaySnapshot ? JSON.stringify(displaySnapshot) : null,
        lat,
        lng,
        routeId,
        stopIndex,
        appVersion,
        now,
        cached.lastFullStateAt,
      ]
    );
  }

  if (lat != null && lng != null) {
    await query(
      `INSERT INTO bus_location_history (bus_id, lat, lng, recorded_at) VALUES ($1, $2, $3, $4)`,
      [busId, lat, lng, now]
    );
  }

  return pgGetBus(busId);
}

export async function pgGetBus(busId) {
  const { rows } = await query('SELECT * FROM bus_telemetry WHERE bus_id = $1', [busId]);
  if (!rows.length) return null;
  const row = rows[0];
  const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    telemetry: parseJson(row.telemetry),
    state: parseJson(row.state),
    displaySnapshot: row.display_snapshot ? parseJson(row.display_snapshot) : null,
    updatedAt: Number(row.updated_at),
  };
}

export async function pgListBuses({ ownerId = null } = {}) {
  let sql = `
    SELECT bp.bus_id, bt.updated_at, bt.telemetry, bp.plate, bp.plate_display, bp.display_name, bp.pairing_code,
           bp.linked_driver_id, bp.linked_at, bp.owner_id
    FROM bus_profiles bp
    LEFT JOIN bus_telemetry bt ON bt.bus_id = bp.bus_id`;
  const params = [];
  if (ownerId) {
    sql += ' WHERE bp.owner_id = $1';
    params.push(ownerId);
  }
  const { rows } = await query(sql, params);
  return rows.map((row) => ({
    busId: row.bus_id,
    updatedAt: Number(row.updated_at ?? 0),
    telemetry: row.telemetry,
    profile: {
      plate: row.plate,
      plateDisplay: row.plate_display,
      displayName: row.display_name ?? '',
      pairingCode: row.pairing_code,
      linkedDriverId: row.linked_driver_id,
      linkedAt: row.linked_at ? Number(row.linked_at) : null,
      ownerId: row.owner_id,
    },
  }));
}

export async function pgFindBusIdByPlateOrCode(plateOrCode, { normalizePlate } = {}) {
  const raw = String(plateOrCode ?? '').trim();
  if (!raw) return null;

  const asPlate = normalizePlate ? normalizePlate(raw) : raw.toUpperCase().replace(/\s+/g, '');
  const asCode = raw.replace(/\D/g, '');

  if (asPlate) {
    const { rows } = await query('SELECT bus_id FROM bus_profiles WHERE plate = $1 LIMIT 1', [asPlate]);
    if (rows[0]?.bus_id) return rows[0].bus_id;
  }

  if (asCode) {
    const { rows } = await query('SELECT bus_id FROM bus_profiles WHERE pairing_code = $1 LIMIT 1', [
      asCode,
    ]);
    if (rows[0]?.bus_id) return rows[0].bus_id;

    const { rows: telRows } = await query(
      `SELECT bus_id FROM bus_telemetry WHERE telemetry->>'pairingCode' = $1 LIMIT 1`,
      [asCode]
    );
    if (telRows[0]?.bus_id) return telRows[0].bus_id;
  }

  return null;
}

export async function pgGetDriverLink(driverId) {
  const { rows } = await query(
    'SELECT linked_bus_id, linked_at FROM drivers WHERE driver_id = $1 LIMIT 1',
    [driverId]
  );
  return rows[0] ?? null;
}

export async function pgUpsertDriverLink(driverId, busId, linkedAt) {
  await query(
    `INSERT INTO drivers (driver_id, linked_bus_id, linked_at, last_seen_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (driver_id) DO UPDATE SET
       linked_bus_id = EXCLUDED.linked_bus_id,
       linked_at = EXCLUDED.linked_at,
       last_seen_at = EXCLUDED.last_seen_at`,
    [driverId, busId, linkedAt, Date.now()]
  );
}

export async function pgClearDriverLink(driverId) {
  await query(
    `UPDATE drivers SET linked_bus_id = NULL, linked_at = NULL, last_seen_at = $2 WHERE driver_id = $1`,
    [driverId, Date.now()]
  );
}

/** Bus IDs with routeId in assigned_route_ids (catalog delete cleanup). */
export async function pgListBusIdsWithAssignedRoute(routeId) {
  const { rows } = await query(
    `SELECT bus_id FROM bus_profiles
     WHERE assigned_route_ids @> $1::jsonb`,
    [JSON.stringify([routeId])]
  );
  return rows.map((r) => r.bus_id);
}

export async function pgGetBusProfile(busId) {
  const { rows } = await query('SELECT * FROM bus_profiles WHERE bus_id = $1', [busId]);
  if (!rows.length) return null;
  const row = rows[0];
  const assignedRaw = row.assigned_route_ids;
  const assignedRouteIds = Array.isArray(assignedRaw)
    ? assignedRaw
    : typeof assignedRaw === 'string'
      ? JSON.parse(assignedRaw)
      : [];
  return {
    plate: row.plate,
    plateDisplay: row.plate_display,
    displayName: row.display_name ?? '',
    pairingCode: row.pairing_code,
    linkedDriverId: row.linked_driver_id,
    linkedAt: row.linked_at ? Number(row.linked_at) : null,
    ownerId: row.owner_id,
    assignedRouteIds,
  };
}

export async function pgUpsertBusProfile(busId, patch = {}) {
  const existing = await pgGetBusProfile(busId);
  const profile = {
    plate: '',
    plateDisplay: '',
    displayName: '',
    pairingCode: String(Math.floor(1000 + Math.random() * 9000)),
    linkedDriverId: null,
    linkedAt: null,
    ownerId: null,
    assignedRouteIds: [],
    ...existing,
    ...patch,
  };
  if (patch.assignedRouteIds) {
    profile.assignedRouteIds = [...new Set(patch.assignedRouteIds.filter(Boolean))];
  }

  await query(
    `INSERT INTO bus_profiles (bus_id, plate, plate_display, display_name, pairing_code, linked_driver_id, linked_at, owner_id, assigned_route_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (bus_id) DO UPDATE SET
       plate = EXCLUDED.plate,
       plate_display = EXCLUDED.plate_display,
       display_name = EXCLUDED.display_name,
       pairing_code = EXCLUDED.pairing_code,
       linked_driver_id = EXCLUDED.linked_driver_id,
       linked_at = EXCLUDED.linked_at,
       owner_id = COALESCE(EXCLUDED.owner_id, bus_profiles.owner_id),
       assigned_route_ids = EXCLUDED.assigned_route_ids`,
    [
      busId,
      profile.plate ?? '',
      profile.plateDisplay ?? '',
      profile.displayName ?? '',
      profile.pairingCode ?? '',
      profile.linkedDriverId,
      profile.linkedAt,
      profile.ownerId,
      JSON.stringify(profile.assignedRouteIds ?? []),
    ]
  );
  return profile;
}

const FLEET_ENROLL_TTL_MS = 30 * 60 * 1000;

export async function pgDeleteBus(busId) {
  const { rowCount } = await query('SELECT 1 FROM bus_profiles WHERE bus_id = $1', [busId]);
  if (!rowCount) return { ok: false, error: 'Bus not found' };

  const now = Date.now();
  await pgRevokeDevicesForBus(busId);
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
  await query('DELETE FROM bus_profiles WHERE bus_id = $1', [busId]);
  return { ok: true, busId };
}

export async function pgHasPendingCommandType(busId, type) {
  const { rows } = await query(
    `SELECT 1 FROM bus_commands WHERE bus_id = $1 AND status = 'pending' AND type = $2 LIMIT 1`,
    [busId, type]
  );
  return rows.length > 0;
}

export async function pgEnqueueCommand(busId, type, payload) {
  const cmd = {
    id: randomUUID(),
    busId,
    type,
    payload,
    status: 'pending',
    createdAt: Date.now(),
  };
  await query(
    `INSERT INTO bus_commands (id, bus_id, type, payload, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', $5)`,
    [cmd.id, busId, type, JSON.stringify(payload ?? {}), cmd.createdAt]
  );
  return cmd;
}

export async function pgPullPendingCommands(busId) {
  const { rows } = await query(
    `SELECT * FROM bus_commands WHERE bus_id = $1 AND status = 'pending' ORDER BY created_at`,
    [busId]
  );
  const pending = rows.map((row) => ({
    id: row.id,
    busId: row.bus_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: Number(row.created_at),
  }));
  if (pending.length) {
    const ids = pending.map((c) => c.id);
    await query(
      `UPDATE bus_commands SET status = 'delivered', delivered_at = $1 WHERE id = ANY($2)`,
      [Date.now(), ids]
    );
  }
  return pending;
}

export async function pgAckCommand(commandId) {
  const now = Date.now();
  const { rows } = await query(
    `UPDATE bus_commands SET status = 'acked', acked_at = $1 WHERE id = $2 RETURNING *`,
    [now, commandId]
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    busId: row.bus_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: Number(row.created_at),
    ackedAt: now,
  };
}

export async function pgPruneCommands() {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  await query(`DELETE FROM bus_commands WHERE status = 'acked' AND acked_at < $1`, [cutoff]);
  const locCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  await query(`DELETE FROM bus_location_history WHERE recorded_at < $1`, [locCutoff]);
}

export async function pgGetLocationHistory(busId, { minutes = 120, limit = 500 } = {}) {
  const since = Date.now() - minutes * 60 * 1000;
  const { rows } = await query(
    `SELECT lat, lng, recorded_at FROM bus_location_history
     WHERE bus_id = $1 AND recorded_at >= $2
     ORDER BY recorded_at ASC
     LIMIT $3`,
    [busId, since, limit]
  );
  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    at: Number(row.recorded_at),
  }));
}

export async function pgGetPlatformSetting(key, fallback = null) {
  const { rows } = await query('SELECT value FROM platform_settings WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

export async function pgSetPlatformSetting(key, value) {
  await query(
    `INSERT INTO platform_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)]
  );
}

export async function pgListAllRoutes(ownerId = null) {
  let sql = 'SELECT id, owner_id, data FROM routes';
  const params = [];
  if (ownerId) {
    sql += ' WHERE owner_id IS NULL OR owner_id = $1';
    params.push(ownerId);
  }
  const { rows } = await query(sql, params);
  return rows.map((r) => {
    const data = r.data;
    return typeof data === 'string' ? JSON.parse(data) : data;
  });
}

export async function pgUpsertRoute(route, ownerId = null) {
  await query(
    `INSERT INTO routes (id, owner_id, data) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, owner_id = COALESCE(EXCLUDED.owner_id, routes.owner_id)`,
    [route.id, ownerId ?? route.ownerId ?? null, JSON.stringify(route)]
  );
  return route;
}

export async function pgDeleteRoute(routeId) {
  const { rowCount } = await query('DELETE FROM routes WHERE id = $1', [routeId]);
  return rowCount > 0;
}

export async function pgGetRouteById(routeId) {
  const { rows } = await query('SELECT data FROM routes WHERE id = $1', [routeId]);
  if (!rows.length) return null;
  const data = rows[0].data;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

export async function pgSearchStopCatalog(queryStr = '') {
  const { rows } = await query('SELECT data FROM stop_catalog');
  const all = rows.map((r) => r.data);
  const q = queryStr.trim().toLowerCase();
  if (!q) return all.slice(0, 50);
  return all.filter(
    (s) =>
      s.en?.toLowerCase().includes(q) ||
      s.ml?.toLowerCase().includes(q)
  );
}

export async function pgUpsertStopCatalog(entry) {
  const existing = await pgGetStopFromCatalog(entry.en);
  const merged = existing
    ? {
        ...existing,
        ...entry,
        en: existing.en || entry.en,
        lat: entry.lat ?? existing.lat ?? null,
        lng: entry.lng ?? existing.lng ?? null,
      }
    : entry;
  await query(
    `INSERT INTO stop_catalog (en, data) VALUES ($1, $2)
     ON CONFLICT (en) DO UPDATE SET data = EXCLUDED.data`,
    [merged.en, JSON.stringify(merged)]
  );
  return merged;
}

export async function pgGetStopFromCatalog(en) {
  const key = String(en ?? '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const { rows } = await query('SELECT data FROM stop_catalog WHERE LOWER(TRIM(en)) = $1', [key]);
  return rows.length ? rows[0].data : null;
}

export async function pgWriteAudit(action, actorId, details = {}) {
  await query(
    `INSERT INTO audit_log (id, action, actor_id, details, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), action, actorId ?? null, JSON.stringify(details), Date.now()]
  );
}

export { ONLINE_MS };
