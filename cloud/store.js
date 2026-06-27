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
      if (!stop.audioMl) missing.push('malayalam_audio');
      if (!stop.audioEn) missing.push('english_audio');
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
