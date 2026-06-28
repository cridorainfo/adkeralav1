import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { usePostgres, runMigrations, query } from './db/pool.js';
import * as pg from './storePg.js';
import { normalizeAdsList, collectAdMediaPathsFromLists } from './adsCatalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const defaultStore = () => ({
  buses: {},
  busProfiles: {},
  drivers: {},
  users: {},
  adCampaigns: {},
  commands: [],
  fleetEnrollments: {},
  busDevices: {},
  auditLog: [],
  releases: {
    pc: null,
    driver: null,
    minPcVersion: '0.1.0',
    minDriverVersion: '0.1.0',
  },
  stopCatalog: [],
  stopAudioCatalog: {},
  stopAudioSavedAt: 0,
  busAdsCatalog: {},
  globalAudioFragments: {},
  globalAudioSavedAt: 0,
  routeCatalog: [
    {
      id: 'route-tvm-kochi',
      name: 'Thiruvananthapuram – Kochi Express',
      startStop: { en: 'Thiruvananthapuram', ml: 'തിരുവനന്തപുരം', lat: 8.4875, lng: 76.9525 },
      endStop: { en: 'Kochi', ml: 'കൊച്ചി', lat: 9.9312, lng: 76.2673 },
      stops: [
        { en: 'Kollam', ml: 'കൊല്ലം', lat: 8.8932, lng: 76.6141 },
        { en: 'Alappuzha', ml: 'ആലപ്പുഴ', lat: 9.4981, lng: 76.3388 },
        { en: 'Ernakulam', ml: 'എറണാകുളം', lat: 9.9816, lng: 76.2999 },
      ],
    },
    {
      id: 'route-kilimanoor-madathara',
      name: 'Kilimanoor – Madathara',
      startStop: { en: 'Kilimanoor', ml: 'കിളിമാനൂർ', lat: 8.6628, lng: 76.8953 },
      endStop: { en: 'Madathara', ml: 'മടത്തറ', lat: 8.8261, lng: 77.0636 },
      stops: [
        { en: 'Mottakuzhy', ml: 'മൊട്ടക്കുഴി', lat: null, lng: null },
        { en: 'Kadakkal', ml: 'കടയ്ക്കൽ', lat: 8.8167, lng: 76.9667 },
        { en: 'Chithara', ml: 'ചിതറ', lat: 8.85, lng: 77.0167 },
      ],
    },
  ],
});

let cache = null;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_DIR, 'media'), { recursive: true });
}

/** Call before accepting traffic — ensures DATA_DIR exists and is writable. */
export async function warmUpStore() {
  if (usePostgres()) {
    await runMigrations();
    await pg.pgPruneCommands();
    await seedRouteCatalogIfEmpty();
    return null;
  }
  await ensureDataDir();
  const store = await loadStore();
  await seedRouteCatalogIfEmpty(store);
  return store;
}

/** Seed demo/shared routes when catalog is empty (Postgres or file store). */
export async function seedRouteCatalogIfEmpty(store = null) {
  const defaults = defaultStore().routeCatalog;
  if (usePostgres()) {
    const existing = await pg.pgListAllRoutes();
    if (existing.length > 0) return existing.length;
    for (const route of defaults) {
      await pg.pgUpsertRoute(route);
      for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
        if (stop?.en) await upsertStopCatalog(stop);
      }
    }
    return defaults.length;
  }
  const s = store ?? (await loadStore());
  if ((s.routeCatalog ?? []).length > 0) return s.routeCatalog.length;
  s.routeCatalog = defaults;
  await saveStore();
  return defaults.length;
}

export async function loadStore() {
  if (cache) return cache;
  await ensureDataDir();
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    cache = { ...defaultStore(), ...JSON.parse(raw) };
  } catch {
    cache = defaultStore();
    await saveStore();
  }
  return cache;
}

export async function saveStore() {
  await ensureDataDir();
  await fs.writeFile(STORE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

async function pgGetBusCompat(busId) {
  return pg.pgGetBus(busId);
}

/** Keep the fresher driverLocation when bus PC and driver phone both push GPS. */
export function mergeDriverLocationTelemetry(incomingTelemetry = {}, existingTelemetry = {}) {
  if (!incomingTelemetry || typeof incomingTelemetry !== 'object') return incomingTelemetry ?? {};
  const incoming = incomingTelemetry.driverLocation;
  const existing = existingTelemetry?.driverLocation;
  if (!existing?.lat || incoming?.lat == null) return incomingTelemetry;
  const incomingAt = incoming?.at ?? 0;
  const existingAt = existing?.at ?? 0;
  if (existingAt > incomingAt) {
    return { ...incomingTelemetry, driverLocation: existing };
  }
  return incomingTelemetry;
}

export async function upsertBusTelemetry(busId, { telemetry, state, displaySnapshot } = {}) {
  if (usePostgres()) {
    const existing = await pg.pgGetBus(busId);
    const mergedTelemetry = mergeDriverLocationTelemetry(
      telemetry ?? {},
      existing?.telemetry ?? {}
    );
    await pg.pgUpsertBusTelemetry(busId, {
      telemetry: mergedTelemetry,
      state,
      displaySnapshot,
    });
    await syncBusProfileFromTelemetry(busId, mergedTelemetry, state ?? {});
    await syncBusAdsCatalogFromTelemetry(busId, state ?? {});
    return pgGetBusCompat(busId);
  }
  const store = await loadStore();
  const existingTelemetry = store.buses[busId]?.telemetry ?? {};
  const mergedTelemetry = mergeDriverLocationTelemetry(telemetry ?? {}, existingTelemetry);
  store.buses[busId] = {
    telemetry: mergedTelemetry,
    state: state ?? {},
    displaySnapshot: displaySnapshot ?? null,
    updatedAt: Date.now(),
  };
  await syncBusProfileFromTelemetry(busId, mergedTelemetry, state ?? {});
  await syncBusAdsCatalogFromTelemetry(busId, state ?? {});
  await saveStore();
  return store.buses[busId];
}

async function resolveLinkedBusId(driverId) {
  const store = await loadStore();
  const fromDriver = store.drivers?.[driverId]?.linkedBusId;
  if (fromDriver) return fromDriver;

  if (usePostgres()) {
    const { rows: profileRows } = await query(
      'SELECT bus_id FROM bus_profiles WHERE linked_driver_id = $1 LIMIT 1',
      [driverId]
    );
    if (profileRows[0]?.bus_id) return profileRows[0].bus_id;

    const { rows: driverRows } = await query(
      'SELECT linked_bus_id FROM drivers WHERE driver_id = $1 LIMIT 1',
      [driverId]
    );
    if (driverRows[0]?.linked_bus_id) return driverRows[0].linked_bus_id;
  }

  for (const [busId, profile] of Object.entries(store.busProfiles ?? {})) {
    if (profile?.linkedDriverId === driverId) return busId;
  }
  return null;
}

/** Live GPS from a paired driver phone — updates fleet map without waiting for bus PC sync. */
export async function updateDriverLocation(driverId, location = {}) {
  const id = String(driverId ?? '').trim();
  if (!id) return { ok: false, error: 'Missing driverId' };

  const lat = location.lat;
  const lng = location.lng;
  if (lat == null || lng == null) {
    return { ok: false, error: 'Missing lat/lng' };
  }

  const busId = await resolveLinkedBusId(id);
  if (!busId) {
    return { ok: false, error: 'Driver not linked to a bus' };
  }

  const at = Number(location.at) || Date.now();
  const driverLocation = {
    lat,
    lng,
    accuracy: location.accuracy ?? null,
    heading: location.heading ?? null,
    speed: location.speed ?? null,
    at,
    source: 'phone',
  };

  if (usePostgres()) {
    const row = await pg.pgPatchDriverLocation(busId, driverLocation);
    return { ok: true, busId, updatedAt: row?.updatedAt ?? Date.now() };
  }

  const store = await loadStore();
  const busRow = store.buses[busId] ?? { telemetry: {}, state: {}, updatedAt: 0 };
  const existing = busRow.telemetry?.driverLocation;
  if ((existing?.at ?? 0) > at && existing?.lat != null) {
    return { ok: true, busId, skipped: true, updatedAt: busRow.updatedAt ?? 0 };
  }

  const telemetry = { ...busRow.telemetry, driverLocation };
  store.buses[busId] = {
    ...busRow,
    telemetry,
    updatedAt: Date.now(),
  };
  await saveStore();
  return { ok: true, busId, updatedAt: store.buses[busId].updatedAt };
}

export async function getBus(busId) {
  if (usePostgres()) return pg.pgGetBus(busId);
  const store = await loadStore();
  return store.buses[busId] ?? null;
}

export async function listBuses({ ownerId = null } = {}) {
  if (usePostgres()) return pg.pgListBuses({ ownerId });
  const store = await loadStore();
  const busIds = new Set([
    ...Object.keys(store.buses ?? {}),
    ...Object.keys(store.busProfiles ?? {}),
  ]);

  const rows = [];
  for (const busId of busIds) {
    const profile = store.busProfiles?.[busId];
    if (ownerId && profile?.ownerId !== ownerId) continue;

    const row = store.buses?.[busId];
    rows.push({
      busId,
      updatedAt: row?.updatedAt ?? 0,
      telemetry: row?.telemetry ?? null,
      profile: profile ?? null,
    });
  }
  return rows;
}

export async function enqueueCommand(busId, type, payload) {
  if (usePostgres()) return pg.pgEnqueueCommand(busId, type, payload);
  const store = await loadStore();
  const cmd = {
    id: randomUUID(),
    busId,
    type,
    payload,
    status: 'pending',
    createdAt: Date.now(),
  };
  store.commands.push(cmd);
  await saveStore();
  return cmd;
}

export async function pullPendingCommands(busId) {
  if (usePostgres()) return pg.pgPullPendingCommands(busId);
  const store = await loadStore();
  const pending = store.commands.filter((c) => c.busId === busId && c.status === 'pending');
  for (const cmd of pending) {
    cmd.status = 'delivered';
    cmd.deliveredAt = Date.now();
  }
  if (pending.length) await saveStore();
  return pending;
}

export async function ackCommand(commandId) {
  if (usePostgres()) return pg.pgAckCommand(commandId);
  const store = await loadStore();
  const cmd = store.commands.find((c) => c.id === commandId);
  if (cmd) {
    cmd.status = 'acked';
    cmd.ackedAt = Date.now();
    await saveStore();
  }
  return cmd;
}

const PG_KEY_GLOBAL_AUDIO = 'global_audio_catalog';
const PG_KEY_STOP_AUDIO = 'stop_audio_catalog';
const PG_KEY_BUS_ADS_PREFIX = 'bus_ads:';

export async function getBusAdsCatalog(busId) {
  if (!busId) return { ads: [], bannerAds: [], savedAt: 0, adsSavedAt: 0, source: null };
  if (usePostgres()) {
    const row = await pg.pgGetPlatformSetting(`${PG_KEY_BUS_ADS_PREFIX}${busId}`, null);
    return {
      ads: row?.ads ?? [],
      bannerAds: row?.bannerAds ?? [],
      savedAt: row?.savedAt ?? 0,
      adsSavedAt: row?.adsSavedAt ?? 0,
      source: row?.source ?? null,
    };
  }
  const store = await loadStore();
  if (!store.busAdsCatalog) store.busAdsCatalog = {};
  const row = store.busAdsCatalog[busId] ?? {};
  return {
    ads: row.ads ?? [],
    bannerAds: row.bannerAds ?? [],
    savedAt: row.savedAt ?? 0,
    adsSavedAt: row.adsSavedAt ?? 0,
    source: row.source ?? null,
  };
}

export async function setBusAdsCatalog(busId, { ads = [], bannerAds = [], adsSavedAt, source = 'dashboard' } = {}) {
  if (!busId) throw new Error('busId required');
  const savedAt = Date.now();
  const payload = {
    ads: normalizeAdsList(ads),
    bannerAds: normalizeAdsList(bannerAds),
    savedAt,
    adsSavedAt: adsSavedAt ?? savedAt,
    source,
  };
  if (usePostgres()) {
    await pg.pgSetPlatformSetting(`${PG_KEY_BUS_ADS_PREFIX}${busId}`, payload);
    return { ...payload, mediaFiles: collectAdMediaPathsFromLists(payload.ads, payload.bannerAds) };
  }
  const store = await loadStore();
  if (!store.busAdsCatalog) store.busAdsCatalog = {};
  store.busAdsCatalog[busId] = payload;
  await saveStore();
  return { ...payload, mediaFiles: collectAdMediaPathsFromLists(payload.ads, payload.bannerAds) };
}

export async function syncBusAdsCatalogFromTelemetry(busId, state = {}) {
  if (!busId || !state) return null;
  const busAds = normalizeAdsList(state.ads);
  const busBanners = normalizeAdsList(state.bannerAds);
  const busAdsAt = state.adsSavedAt ?? 0;
  const current = await getBusAdsCatalog(busId);
  const catalogAt = current.adsSavedAt ?? current.savedAt ?? 0;
  const catalogEmpty = !current.ads?.length && !current.bannerAds?.length;
  const busHasAds = busAds.length > 0 || busBanners.length > 0;
  const busIsNewer = busAdsAt > catalogAt;
  const seedFromBus = catalogEmpty && busHasAds;
  if (!busIsNewer && !seedFromBus) return null;
  return setBusAdsCatalog(busId, {
    ads: busAds,
    bannerAds: busBanners,
    adsSavedAt: busAdsAt || Date.now(),
    source: 'bus',
  });
}

export async function getGlobalPhraseAudio() {
  if (usePostgres()) {
    const row = await pg.pgGetPlatformSetting(PG_KEY_GLOBAL_AUDIO, null);
    const audioFragments = row?.audioFragments ?? {};
    return {
      audioFragments,
      savedAt: row?.savedAt ?? 0,
      mediaFiles: collectGlobalPhraseMediaPaths(audioFragments),
    };
  }
  const store = await loadStore();
  return {
    audioFragments: store.globalAudioFragments ?? {},
    savedAt: store.globalAudioSavedAt ?? 0,
    mediaFiles: collectGlobalPhraseMediaPaths(store.globalAudioFragments ?? {}),
  };
}

export async function setGlobalPhraseAudio(audioFragments, mediaFiles = []) {
  const savedAt = Date.now();
  if (usePostgres()) {
    const payload = { audioFragments: audioFragments ?? {}, savedAt };
    await pg.pgSetPlatformSetting(PG_KEY_GLOBAL_AUDIO, payload);
    return {
      audioFragments: payload.audioFragments,
      savedAt,
      mediaFiles: mediaFiles.length ? mediaFiles : collectGlobalPhraseMediaPaths(payload.audioFragments),
    };
  }
  const store = await loadStore();
  store.globalAudioFragments = audioFragments ?? {};
  store.globalAudioSavedAt = savedAt;
  await saveStore();
  return {
    audioFragments: store.globalAudioFragments,
    savedAt: store.globalAudioSavedAt,
    mediaFiles: mediaFiles.length ? mediaFiles : collectGlobalPhraseMediaPaths(store.globalAudioFragments),
  };
}

function collectAudioMediaPathsFromMap(map = {}) {
  const paths = new Set();
  for (const entry of Object.values(map)) {
    for (const lang of Object.values(entry ?? {})) {
      const file = lang?.audioFile;
      if (file && typeof file === 'string') paths.add(file);
    }
  }
  return [...paths];
}

function collectGlobalPhraseMediaPaths(map = {}) {
  return collectAudioMediaPathsFromMap(map);
}

export async function getStopAudioCatalog() {
  if (usePostgres()) {
    const row = await pg.pgGetPlatformSetting(PG_KEY_STOP_AUDIO, null);
    const stopAudio = row?.stopAudio ?? {};
    return {
      stopAudio,
      savedAt: row?.savedAt ?? 0,
      mediaFiles: collectAudioMediaPathsFromMap(stopAudio),
    };
  }
  const store = await loadStore();
  const stopAudio = store.stopAudioCatalog ?? {};
  return {
    stopAudio,
    savedAt: store.stopAudioSavedAt ?? 0,
    mediaFiles: collectAudioMediaPathsFromMap(stopAudio),
  };
}

export async function mergeStopAudioCatalog(entries = {}, mediaFiles = []) {
  const savedAt = Date.now();
  if (usePostgres()) {
    const current = await getStopAudioCatalog();
    const stopAudio = { ...(current.stopAudio ?? {}), ...entries };
    await pg.pgSetPlatformSetting(PG_KEY_STOP_AUDIO, { stopAudio, savedAt });
    return {
      stopAudio,
      savedAt,
      mediaFiles: mediaFiles.length ? mediaFiles : collectAudioMediaPathsFromMap(stopAudio),
    };
  }
  const store = await loadStore();
  store.stopAudioCatalog = { ...(store.stopAudioCatalog ?? {}), ...entries };
  store.stopAudioSavedAt = savedAt;
  await saveStore();
  return {
    stopAudio: store.stopAudioCatalog,
    savedAt: store.stopAudioSavedAt,
    mediaFiles: mediaFiles.length ? mediaFiles : collectAudioMediaPathsFromMap(store.stopAudioCatalog),
  };
}

/** Stop audio entries for all stops on a route (keyed by stop English name, lowercased). */
export function getStopAudioForRoute(route, stopAudioCatalog = {}) {
  if (!route) return {};
  const result = {};
  for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
    const key = stop.en?.toLowerCase?.();
    if (!key) continue;
    const entry = stopAudioCatalog[key];
    if (entry) result[key] = entry;
  }
  return result;
}

export async function searchRoutes(query = '', { ownerId = null } = {}) {
  const routes = usePostgres() ? await pg.pgListAllRoutes(ownerId) : (await loadStore()).routeCatalog;
  const q = query.trim().toLowerCase();
  if (!q) return routes;
  return routes.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.startStop?.en?.toLowerCase().includes(q) ||
      r.endStop?.en?.toLowerCase().includes(q)
  );
}

function stopNamesMatch(a, b) {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Find shared routes matching start + end stop names (for route creation suggestions). */
export async function matchRoutesByEndpoints(startEn, endEn) {
  const catalog = await listAllRoutes();
  const start = String(startEn ?? '').trim();
  const end = String(endEn ?? '').trim();
  if (!start || !end) return [];

  const hits = [];
  const seen = new Set();

  for (const route of catalog ?? []) {
    if (!route?.startStop?.en || !route?.endStop?.en) continue;

    const forward =
      stopNamesMatch(route.startStop.en, start) && stopNamesMatch(route.endStop.en, end);
    const reverse =
      stopNamesMatch(route.startStop.en, end) && stopNamesMatch(route.endStop.en, start);

    if (!forward && !reverse) continue;

    const key = route.id ?? route.name;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      route,
      direction: forward ? 'forward' : 'reverse',
      stopCount: 2 + (route.stops?.length ?? 0),
    });
  }

  return hits.sort((a, b) => a.route.name.localeCompare(b.route.name));
}

export async function listAllRoutes() {
  if (usePostgres()) return pg.pgListAllRoutes();
  const store = await loadStore();
  return store.routeCatalog;
}

export async function getRouteById(routeId) {
  if (usePostgres()) return pg.pgGetRouteById(routeId);
  const store = await loadStore();
  return store.routeCatalog.find((r) => r.id === routeId) ?? null;
}

export async function upsertRouteCatalog(route) {
  if (usePostgres()) return pg.pgUpsertRoute(route, route.ownerId ?? null);
  const store = await loadStore();
  const idx = store.routeCatalog.findIndex((r) => r.id === route.id);
  if (idx >= 0) store.routeCatalog[idx] = route;
  else store.routeCatalog.push(route);
  await saveStore();
  return route;
}

export async function deleteRouteFromCatalog(routeId) {
  if (usePostgres()) return pg.pgDeleteRoute(routeId);
  const store = await loadStore();
  const before = store.routeCatalog.length;
  store.routeCatalog = store.routeCatalog.filter((r) => r.id !== routeId);
  if (store.routeCatalog.length === before) return false;
  await saveStore();
  return true;
}

function normalizeCatalogStop(body = {}) {
  return {
    en: String(body.en ?? '').trim(),
    ml: String(body.ml ?? '').trim(),
    lat: body.lat != null && body.lat !== '' ? Number(body.lat) : null,
    lng: body.lng != null && body.lng !== '' ? Number(body.lng) : null,
    radiusM: Number.isFinite(Number(body.radiusM)) ? Number(body.radiusM) : 80,
    updatedAt: Date.now(),
  };
}

function stopCatalogKey(en) {
  return String(en ?? '')
    .trim()
    .toLowerCase();
}

export async function searchStopCatalog(query = '') {
  if (usePostgres()) return pg.pgSearchStopCatalog(query);
  const store = await loadStore();
  const catalog = store.stopCatalog ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, 50);
  return catalog.filter(
    (s) => s.en?.toLowerCase().includes(q) || s.ml?.toLowerCase().includes(q)
  );
}

export async function upsertStopCatalog(entry) {
  if (usePostgres()) {
    const next = normalizeCatalogStop(entry);
    if (!next.en) return null;
    return pg.pgUpsertStopCatalog(next);
  }
  const store = await loadStore();
  if (!store.stopCatalog) store.stopCatalog = [];
  const next = normalizeCatalogStop(entry);
  if (!next.en) return null;

  const key = stopCatalogKey(next.en);
  const idx = store.stopCatalog.findIndex((s) => stopCatalogKey(s.en) === key);
  if (idx >= 0) {
    store.stopCatalog[idx] = {
      ...store.stopCatalog[idx],
      ...next,
      en: store.stopCatalog[idx].en || next.en,
    };
  } else {
    store.stopCatalog.push(next);
  }
  await saveStore();
  return store.stopCatalog.find((s) => stopCatalogKey(s.en) === key);
}

export async function getStopFromCatalog(en) {
  if (usePostgres()) return pg.pgGetStopFromCatalog(en);
  const store = await loadStore();
  const key = stopCatalogKey(en);
  return (store.stopCatalog ?? []).find((s) => stopCatalogKey(s.en) === key) ?? null;
}

/** Seed stop catalog from route catalog on first load. */
export async function ensureStopCatalogFromRoutes() {
  if (usePostgres()) {
    const { rows } = await query('SELECT COUNT(*)::int AS n FROM stop_catalog');
    if ((rows[0]?.n ?? 0) > 0) {
      return pg.pgSearchStopCatalog('');
    }
    const routes = await listAllRoutes();
    for (const route of routes) {
      const stops = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);
      for (const stop of stops) {
        if (stop?.en) await upsertStopCatalog(stop);
      }
    }
    return pg.pgSearchStopCatalog('');
  }

  const store = await loadStore();
  if ((store.stopCatalog ?? []).length > 0) return store.stopCatalog;

  for (const route of store.routeCatalog ?? []) {
    const stops = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);
    for (const stop of stops) {
      if (stop?.en) await upsertStopCatalog(stop);
    }
  }
  const refreshed = await loadStore();
  return refreshed.stopCatalog ?? [];
}

export async function patchStopInCatalog(routeId, stopKey, patch) {
  const store = await loadStore();
  const route = store.routeCatalog.find((r) => r.id === routeId);
  if (!route) return null;

  const apply = (stop) => {
    if (stop.en?.toLowerCase() !== stopKey.toLowerCase()) return stop;
    return { ...stop, ...patch };
  };

  route.startStop = apply(route.startStop ?? {});
  route.endStop = apply(route.endStop ?? {});
  route.stops = (route.stops ?? []).map(apply);
  await saveStore();
  return route;
}

export function scanCatalogGaps(routeCatalog, busStates = {}, stopAudioCatalog = {}) {
  const gaps = [];

  for (const route of routeCatalog) {
    const allStops = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);

    for (const stop of allStops) {
      const missing = [];
      if (!stop.ml) missing.push('malayalam_text');
      if (!stop.lat || !stop.lng) missing.push('gps_coords');

      const stopKey = stop.en?.toLowerCase?.() ?? '';
      let hasAudio = false;
      const catalogEntry = stopAudioCatalog[stopKey];
      if (catalogEntry?.en?.audioFile || catalogEntry?.en?.audioUrl) hasAudio = true;
      if (catalogEntry?.ml?.audioFile || catalogEntry?.ml?.audioUrl) hasAudio = true;
      if (!hasAudio) {
        for (const [, row] of Object.entries(busStates)) {
          const stopAudio = row.state?.stopAudio ?? {};
          const entry = stopAudio[stopKey];
          if (entry?.ml?.audioFile || entry?.ml?.audioUrl) hasAudio = true;
          if (entry?.en?.audioFile || entry?.en?.audioUrl) hasAudio = true;
        }
      }
      if (!hasAudio) missing.push('stop_audio');

      if (!missing.length) continue;

      gaps.push({
        routeId: route.id,
        routeName: route.name,
        stopEn: stop.en,
        stopMl: stop.ml || null,
        lat: stop.lat ?? null,
        lng: stop.lng ?? null,
        missing,
        busesOnRoute: Object.entries(busStates)
          .filter(([, row]) => row.state?.activeRouteId === route.id)
          .map(([busId]) => busId),
      });
    }
  }

  return gaps;
}

export function normalizePlate(plate) {
  return String(plate ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
}

export function formatPlateDisplay(plate) {
  const n = normalizePlate(plate);
  if (!n) return '';
  return n;
}

export function generatePairingCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function ensureBusProfile(store, busId) {
  if (!store.busProfiles) store.busProfiles = {};
  if (!store.busProfiles[busId]) {
    store.busProfiles[busId] = {
      plate: '',
      plateDisplay: '',
      displayName: '',
      pairingCode: generatePairingCode(),
      linkedDriverId: null,
      linkedAt: null,
      ownerId: null,
    };
  }
  return store.busProfiles[busId];
}

export async function getBusProfile(busId) {
  if (usePostgres()) return pg.pgGetBusProfile(busId);
  const store = await loadStore();
  return store.busProfiles?.[busId] ?? null;
}

export async function upsertBusProfile(busId, patch = {}) {
  if (usePostgres()) return pg.pgUpsertBusProfile(busId, patch);
  const store = await loadStore();
  const profile = ensureBusProfile(store, busId);
  Object.assign(profile, patch);
  await saveStore();
  return profile;
}

export async function setBusProfilePlate(busId, plateInput) {
  const store = await loadStore();
  const profile = ensureBusProfile(store, busId);
  const plate = normalizePlate(plateInput);
  profile.plate = plate;
  profile.plateDisplay = String(plateInput ?? '').trim() || plate;
  if (!profile.pairingCode) profile.pairingCode = generatePairingCode();
  await saveStore();
  return profile;
}

function findBusIdByPlateOrCode(store, plateOrCode) {
  const raw = String(plateOrCode ?? '').trim();
  if (!raw) return null;

  const asPlate = normalizePlate(raw);
  const asCode = raw.replace(/\D/g, '');

  for (const [busId, profile] of Object.entries(store.busProfiles ?? {})) {
    if (profile.plate && profile.plate === asPlate) return busId;
    if (profile.pairingCode && profile.pairingCode === asCode) return busId;
  }

  for (const [busId, row] of Object.entries(store.buses ?? {})) {
    const tel = row.telemetry ?? {};
    const stateProfile = row.state?.busProfile ?? {};
    if (stateProfile.plate && stateProfile.plate === asPlate) return busId;
    if (tel.pairingCode && tel.pairingCode === asCode) return busId;
    if (stateProfile.pairingCode && stateProfile.pairingCode === asCode) return busId;
  }

  return null;
}

/** Find an existing fleet bus by normalized plate (reinstall / new fleet code). */
export async function findBusIdByPlate(plateInput) {
  const asPlate = normalizePlate(plateInput);
  if (!asPlate) return null;
  if (usePostgres()) {
    const { rows } = await query(
      'SELECT bus_id FROM bus_profiles WHERE plate = $1 ORDER BY bus_id LIMIT 1',
      [asPlate]
    );
    return rows[0]?.bus_id ?? null;
  }
  const store = await loadStore();
  return findBusIdByPlateOrCode(store, asPlate);
}

export async function syncBusProfileFromTelemetry(busId, telemetry = {}, state = {}) {
  if (usePostgres()) {
    const profile = (await pg.pgGetBusProfile(busId)) ?? {};
    const fromState = state.busProfile ?? {};
    const patch = {};
    if (fromState.plate && !profile.plate) {
      patch.plate = normalizePlate(fromState.plate);
      patch.plateDisplay = fromState.plateDisplay || fromState.plate;
    }
    if (fromState.pairingCode) patch.pairingCode = fromState.pairingCode;
    if (telemetry.pairingCode && !state.driverLink) patch.pairingCode = telemetry.pairingCode;
    if (Object.keys(patch).length) return pg.pgUpsertBusProfile(busId, patch);
    return profile;
  }
  const store = await loadStore();
  const profile = ensureBusProfile(store, busId);
  const fromState = state.busProfile ?? {};

  if (fromState.plate && !profile.plate) {
    profile.plate = normalizePlate(fromState.plate);
    profile.plateDisplay = fromState.plateDisplay || fromState.plate;
  }
  if (fromState.pairingCode) profile.pairingCode = fromState.pairingCode;
  if (telemetry.pairingCode && !state.driverLink) {
    profile.pairingCode = telemetry.pairingCode;
  }

  await saveStore();
  return profile;
}

async function queueDriverLinkMerge(busId, payload) {
  return enqueueCommand(busId, 'MERGE_STATE', {
    ...payload,
    savedAt: Date.now(),
  });
}

export async function pairDriver(driverId, plateOrCode) {
  const store = await loadStore();
  if (!driverId) return { ok: false, error: 'Missing driverId' };

  if (!store.drivers) store.drivers = {};
  const driver = store.drivers[driverId] ?? { linkedBusId: null, linkedAt: null, label: 'Driver' };

  if (driver.linkedBusId) {
    return { ok: false, error: 'Driver already linked to a bus. Unlink first.' };
  }

  const busId = findBusIdByPlateOrCode(store, plateOrCode);
  if (!busId) {
    return { ok: false, error: 'Bus not found. Check plate or code.' };
  }

  const busRow = store.buses[busId];
  const online = busRow && Date.now() - busRow.updatedAt < 20000;
  if (!online) {
    return { ok: false, error: 'Bus is offline. Start the bus server first.' };
  }

  const profile = ensureBusProfile(store, busId);
  if (profile.linkedDriverId && profile.linkedDriverId !== driverId) {
    return { ok: false, error: 'Bus already linked to another driver.' };
  }

  const linkedAt = Date.now();
  profile.linkedDriverId = driverId;
  profile.linkedAt = linkedAt;
  store.drivers[driverId] = {
    ...driver,
    linkedBusId: busId,
    linkedAt,
  };

  await saveStore();
  await queueDriverLinkMerge(busId, {
    driverLink: { driverId, linkedAt },
    busProfile: {
      plate: profile.plate,
      plateDisplay: profile.plateDisplay,
      pairingCode: profile.pairingCode,
    },
  });

  return {
    ok: true,
    busId,
    plate: profile.plateDisplay || profile.plate,
    pairingCode: profile.pairingCode,
    linkedAt,
  };
}

export async function unlinkDriver(driverId) {
  const store = await loadStore();
  if (!driverId) return { ok: false, error: 'Missing driverId' };

  const driver = store.drivers?.[driverId];
  if (!driver?.linkedBusId) {
    return { ok: false, error: 'Driver is not linked.' };
  }

  const busId = driver.linkedBusId;
  const profile = ensureBusProfile(store, busId);
  const newCode = generatePairingCode();

  profile.linkedDriverId = null;
  profile.linkedAt = null;
  profile.pairingCode = newCode;
  driver.linkedBusId = null;
  driver.linkedAt = null;

  await saveStore();
  await queueDriverLinkMerge(busId, {
    driverLink: null,
    busProfile: {
      plate: profile.plate,
      plateDisplay: profile.plateDisplay,
      pairingCode: newCode,
    },
  });

  return { ok: true, busId, pairingCode: newCode };
}

export async function unlinkDriverByBusId(busId) {
  const store = await loadStore();
  const profile = store.busProfiles?.[busId];
  if (!profile?.linkedDriverId) {
    return { ok: false, error: 'No driver linked to this bus.' };
  }
  return unlinkDriver(profile.linkedDriverId);
}

export async function deleteBus(busId) {
  if (usePostgres()) return pg.pgDeleteBus(busId);
  const store = await loadStore();
  if (!store.busProfiles?.[busId]) {
    return { ok: false, error: 'Bus not found' };
  }
  delete store.busProfiles[busId];
  delete store.buses[busId];
  for (const driver of Object.values(store.drivers ?? {})) {
    if (driver.linkedBusId === busId) {
      driver.linkedBusId = null;
      driver.linkedAt = null;
    }
  }
  await saveStore();
  return { ok: true, busId };
}

export async function getDriverSession(driverId) {
  const store = await loadStore();
  if (!driverId) return { ok: false, error: 'Missing driverId' };

  const driver = store.drivers?.[driverId];
  if (!driver?.linkedBusId) {
    return { ok: true, linked: false, driverId };
  }

  const busId = driver.linkedBusId;
  const profile = store.busProfiles?.[busId] ?? {};
  const busRow = store.buses[busId];
  const online = busRow && Date.now() - busRow.updatedAt < 20000;
  const telemetry = busRow?.telemetry ?? {};

  return {
    ok: true,
    linked: true,
    driverId,
    busId,
    plate: profile.plateDisplay || profile.plate || busId,
    pairingCode: profile.pairingCode ?? null,
    lanIp: telemetry.lanIp ?? null,
    controlPort: telemetry.controlPort ?? 5174,
    online: Boolean(online),
    linkedAt: driver.linkedAt ?? profile.linkedAt ?? null,
  };
}
