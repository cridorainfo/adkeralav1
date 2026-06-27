import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

const defaultStore = () => ({
  buses: {},
  commands: [],
  stopCatalog: [],
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

export async function upsertBusTelemetry(busId, { telemetry, state, displaySnapshot }) {
  const store = await loadStore();
  store.buses[busId] = {
    telemetry: telemetry ?? {},
    state: state ?? {},
    displaySnapshot: displaySnapshot ?? null,
    updatedAt: Date.now(),
  };
  await saveStore();
  return store.buses[busId];
}

export async function getBus(busId) {
  const store = await loadStore();
  return store.buses[busId] ?? null;
}

export async function listBuses() {
  const store = await loadStore();
  return Object.entries(store.buses).map(([busId, row]) => ({
    busId,
    updatedAt: row.updatedAt,
    telemetry: row.telemetry,
  }));
}

export async function enqueueCommand(busId, type, payload) {
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
  const store = await loadStore();
  const cmd = store.commands.find((c) => c.id === commandId);
  if (cmd) {
    cmd.status = 'acked';
    cmd.ackedAt = Date.now();
    await saveStore();
  }
  return cmd;
}

export async function getGlobalPhraseAudio() {
  const store = await loadStore();
  return {
    audioFragments: store.globalAudioFragments ?? {},
    savedAt: store.globalAudioSavedAt ?? 0,
    mediaFiles: collectGlobalPhraseMediaPaths(store.globalAudioFragments ?? {}),
  };
}

export async function setGlobalPhraseAudio(audioFragments, mediaFiles = []) {
  const store = await loadStore();
  store.globalAudioFragments = audioFragments ?? {};
  store.globalAudioSavedAt = Date.now();
  await saveStore();
  return {
    audioFragments: store.globalAudioFragments,
    savedAt: store.globalAudioSavedAt,
    mediaFiles: mediaFiles.length ? mediaFiles : collectGlobalPhraseMediaPaths(store.globalAudioFragments),
  };
}

function collectGlobalPhraseMediaPaths(map = {}) {
  const paths = new Set();
  for (const entry of Object.values(map)) {
    for (const lang of Object.values(entry ?? {})) {
      const file = lang?.audioFile;
      if (file && typeof file === 'string') paths.add(file);
    }
  }
  return [...paths];
}

export async function searchRoutes(query = '') {
  const store = await loadStore();
  const q = query.trim().toLowerCase();
  if (!q) return store.routeCatalog;
  return store.routeCatalog.filter(
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
  const store = await loadStore();
  const start = String(startEn ?? '').trim();
  const end = String(endEn ?? '').trim();
  if (!start || !end) return [];

  const hits = [];
  const seen = new Set();

  for (const route of store.routeCatalog ?? []) {
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

export async function getRouteById(routeId) {
  const store = await loadStore();
  return store.routeCatalog.find((r) => r.id === routeId) ?? null;
}

export async function upsertRouteCatalog(route) {
  const store = await loadStore();
  const idx = store.routeCatalog.findIndex((r) => r.id === route.id);
  if (idx >= 0) store.routeCatalog[idx] = route;
  else store.routeCatalog.push(route);
  await saveStore();
  return route;
}

export async function deleteRouteFromCatalog(routeId) {
  const store = await loadStore();
  const before = store.routeCatalog.length;
  store.routeCatalog = store.routeCatalog.filter((r) => r.id !== routeId);
  if (store.routeCatalog.length === before) return false;
  await saveStore();
  return true;
}

export async function listAllRoutes() {
  const store = await loadStore();
  return store.routeCatalog;
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
  const store = await loadStore();
  const catalog = store.stopCatalog ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, 50);
  return catalog.filter(
    (s) => s.en?.toLowerCase().includes(q) || s.ml?.toLowerCase().includes(q)
  );
}

export async function upsertStopCatalog(entry) {
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
  const store = await loadStore();
  const key = stopCatalogKey(en);
  return (store.stopCatalog ?? []).find((s) => stopCatalogKey(s.en) === key) ?? null;
}

/** Seed stop catalog from route catalog on first load. */
export async function ensureStopCatalogFromRoutes() {
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

export function scanCatalogGaps(routeCatalog, busStates = {}) {
  const gaps = [];

  for (const route of routeCatalog) {
    const allStops = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);

    for (const stop of allStops) {
      const missing = [];
      if (!stop.ml) missing.push('malayalam_text');
      if (!stop.lat || !stop.lng) missing.push('gps_coords');

      const stopKey = stop.en?.toLowerCase?.() ?? '';
      let hasAudio = false;
      for (const [, row] of Object.entries(busStates)) {
        const stopAudio = row.state?.stopAudio ?? {};
        const entry = stopAudio[stopKey];
        if (entry?.ml?.audioFile || entry?.ml?.audioUrl) hasAudio = true;
        if (entry?.en?.audioFile || entry?.en?.audioUrl) hasAudio = true;
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
