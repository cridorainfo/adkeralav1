import { randomUUID } from 'crypto';
import { query } from './db/pool.js';

const FULL_STATE_INTERVAL_MS = Number(process.env.ADKERALA_FULL_STATE_INTERVAL_MS ?? 60000);
const ONLINE_MS = Number(process.env.ADKERALA_ONLINE_MS ?? 20000);

const telemetryStateCache = new Map();

export async function pgWarmUp() {
  /* migrations run separately */
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
  return {
    telemetry: row.telemetry,
    state: row.state,
    displaySnapshot: row.display_snapshot,
    updatedAt: Number(row.updated_at),
  };
}

export async function pgListBuses({ ownerId = null } = {}) {
  let sql = `
    SELECT bp.bus_id, bt.updated_at, bt.telemetry, bp.plate, bp.plate_display, bp.pairing_code,
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
      pairingCode: row.pairing_code,
      linkedDriverId: row.linked_driver_id,
      linkedAt: row.linked_at ? Number(row.linked_at) : null,
      ownerId: row.owner_id,
    },
  }));
}

export async function pgGetBusProfile(busId) {
  const { rows } = await query('SELECT * FROM bus_profiles WHERE bus_id = $1', [busId]);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    plate: row.plate,
    plateDisplay: row.plate_display,
    pairingCode: row.pairing_code,
    linkedDriverId: row.linked_driver_id,
    linkedAt: row.linked_at ? Number(row.linked_at) : null,
    ownerId: row.owner_id,
  };
}

export async function pgUpsertBusProfile(busId, patch = {}) {
  const existing = await pgGetBusProfile(busId);
  const profile = {
    plate: '',
    plateDisplay: '',
    pairingCode: String(Math.floor(1000 + Math.random() * 9000)),
    linkedDriverId: null,
    linkedAt: null,
    ownerId: null,
    ...existing,
    ...patch,
  };

  await query(
    `INSERT INTO bus_profiles (bus_id, plate, plate_display, pairing_code, linked_driver_id, linked_at, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (bus_id) DO UPDATE SET
       plate = EXCLUDED.plate,
       plate_display = EXCLUDED.plate_display,
       pairing_code = EXCLUDED.pairing_code,
       linked_driver_id = EXCLUDED.linked_driver_id,
       linked_at = EXCLUDED.linked_at,
       owner_id = COALESCE(EXCLUDED.owner_id, bus_profiles.owner_id)`,
    [
      busId,
      profile.plate ?? '',
      profile.plateDisplay ?? '',
      profile.pairingCode ?? '',
      profile.linkedDriverId,
      profile.linkedAt,
      profile.ownerId,
    ]
  );
  return profile;
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
  await query(
    `INSERT INTO stop_catalog (en, data) VALUES ($1, $2)
     ON CONFLICT (en) DO UPDATE SET data = EXCLUDED.data`,
    [entry.en, JSON.stringify(entry)]
  );
  return entry;
}

export async function pgGetStopFromCatalog(en) {
  const { rows } = await query('SELECT data FROM stop_catalog WHERE en = $1', [en]);
  return rows.length ? rows[0].data : null;
}

export async function pgWriteAudit(action, actorId, details = {}) {
  await query(
    `INSERT INTO audit_log (id, action, actor_id, details, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), action, actorId ?? null, JSON.stringify(details), Date.now()]
  );
}

export { ONLINE_MS };
