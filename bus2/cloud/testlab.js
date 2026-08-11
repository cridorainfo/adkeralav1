import { randomUUID } from 'crypto';
import { usePostgres } from './db/pool.js';
import { pgGetPlatformSetting, pgSetPlatformSetting } from './storePg.js';
import { loadStore, saveStore } from './store.js';

// Deliberately its own storage namespace ('testlab'), completely separate from routes/buses —
// the standalone GPS reliability test app (bus2/gps-test/) reads/writes here, and NOTHING in
// the live fleet/driver-app code path ever reads this key. That isolation is the whole point:
// this test can't regress production no matter what it does.
//
// Same storage pattern as cloud/releases.js's loadReleaseStore/saveReleaseStore — Postgres
// platform_settings when available, the JSON file store otherwise.

function defaultTestLabStore() {
  return { routes: [] };
}

async function loadTestLabStore() {
  if (usePostgres()) {
    return { ...defaultTestLabStore(), ...(await pgGetPlatformSetting('testlab', defaultTestLabStore())) };
  }
  const store = await loadStore();
  return { ...defaultTestLabStore(), ...(store.testlab ?? {}) };
}

async function saveTestLabStore(testlab) {
  if (usePostgres()) {
    await pgSetPlatformSetting('testlab', testlab);
    return;
  }
  const store = await loadStore();
  store.testlab = testlab;
  await saveStore();
}

function normalizeStop(stop, index) {
  const lat = Number(stop?.lat);
  const lng = Number(stop?.lng);
  return {
    en: String(stop?.en ?? `Stop ${index + 1}`).trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    radiusM: Number(stop?.radiusM) > 0 ? Number(stop.radiusM) : 80,
  };
}

export async function listTestRoutes() {
  const store = await loadTestLabStore();
  return store.routes;
}

export async function getTestRoute(id) {
  const store = await loadTestLabStore();
  return store.routes.find((r) => r.id === id) ?? null;
}

export async function saveTestRoute({ id, name, stops }) {
  const store = await loadTestLabStore();
  const cleanStops = Array.isArray(stops) ? stops.map(normalizeStop) : [];
  const now = Date.now();

  if (id) {
    const idx = store.routes.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('Test route not found');
    store.routes[idx] = { ...store.routes[idx], name: String(name ?? '').trim(), stops: cleanStops, updatedAt: now };
    await saveTestLabStore(store);
    return store.routes[idx];
  }

  const route = {
    id: randomUUID(),
    name: String(name ?? '').trim() || 'Untitled test route',
    stops: cleanStops,
    createdAt: now,
    updatedAt: now,
  };
  store.routes.push(route);
  await saveTestLabStore(store);
  return route;
}

export async function deleteTestRoute(id) {
  const store = await loadTestLabStore();
  const before = store.routes.length;
  store.routes = store.routes.filter((r) => r.id !== id);
  if (store.routes.length === before) return false;
  await saveTestLabStore(store);
  return true;
}

// Event log — capped per route so this can never grow into a real storage concern; this is a
// personal reliability test, not a data pipeline. Keeps the newest MAX_EVENTS_PER_ROUTE only.
const MAX_EVENTS_PER_ROUTE = 2000;

export async function recordTestEvent(event) {
  if (!event?.routeId) throw new Error('routeId required');
  const store = await loadTestLabStore();
  const route = store.routes.find((r) => r.id === event.routeId);
  if (!route) throw new Error('Unknown test route');

  route.events = route.events ?? [];
  route.events.push({
    type: String(event.type ?? 'unknown'),
    message: String(event.message ?? ''),
    stop: event.stop ?? null,
    distanceM: event.distanceM ?? null,
    stopIndex: event.stopIndex ?? null,
    direction: event.direction ?? null,
    at: Number(event.at) || Date.now(),
    receivedAt: Date.now(),
  });
  if (route.events.length > MAX_EVENTS_PER_ROUTE) {
    route.events = route.events.slice(route.events.length - MAX_EVENTS_PER_ROUTE);
  }
  await saveTestLabStore(store);
  return true;
}
