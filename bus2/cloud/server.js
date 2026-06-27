import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  upsertBusTelemetry,
  getBus,
  listBuses,
  enqueueCommand,
  pullPendingCommands,
  ackCommand,
  searchRoutes,
  matchRoutesByEndpoints,
  getRouteById,
  patchStopInCatalog,
  upsertRouteCatalog,
  deleteRouteFromCatalog,
  listAllRoutes,
  searchStopCatalog,
  upsertStopCatalog,
  getStopFromCatalog,
  ensureStopCatalogFromRoutes,
  loadStore,
  scanCatalogGaps,
  getGlobalPhraseAudio,
  setGlobalPhraseAudio,
  getBusProfile,
  setBusProfilePlate,
  upsertBusProfile,
  pairDriver,
  unlinkDriver,
  unlinkDriverByBusId,
  getDriverSession,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const ADMIN_KEY = process.env.ADKERALA_ADMIN_KEY ?? 'change-me-in-production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

if (ADMIN_KEY === 'change-me-in-production' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Set ADKERALA_ADMIN_KEY in production!');
}

const app = express();
app.use(express.json({ limit: '25mb' }));

app.use('/api/driver', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function authAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] ?? req.query.key;
  if (key !== ADMIN_KEY) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

function authBus(req, res, next) {
  const key = req.headers['x-bus-key'] ?? '';
  const expected = process.env.ADKERALA_BUS_KEY ?? '';
  if (expected && key !== expected) {
    res.status(401).json({ ok: false, error: 'Invalid bus key' });
    return;
  }
  next();
}

function normalizeRoute(body) {
  const id = body.id || `route-${randomUUID().slice(0, 8)}`;
  return {
    id,
    name: String(body.name ?? 'Unnamed route').trim(),
    startStop: body.startStop ?? { en: '', ml: '', lat: null, lng: null, radiusM: 80 },
    endStop: body.endStop ?? { en: '', ml: '', lat: null, lng: null, radiusM: 80 },
    stops: Array.isArray(body.stops) ? body.stops : [],
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'adkerala-cloud', version: 3 });
});

app.get('/api/buses', authAdmin, async (_req, res) => {
  const buses = await listBuses();
  res.json({ ok: true, buses });
});

app.get('/api/buses/:busId/telemetry', authAdmin, async (req, res) => {
  const row = await getBus(req.params.busId);
  const profile = await getBusProfile(req.params.busId);
  if (!row) {
    res.json({ ok: true, online: false, telemetry: null, state: null, displaySnapshot: null, profile });
    return;
  }
  const online = Date.now() - row.updatedAt < 15000;
  res.json({
    ok: true,
    online,
    telemetry: row.telemetry,
    state: row.state,
    displaySnapshot: row.displaySnapshot,
    profile,
    updatedAt: row.updatedAt,
  });
});

app.put('/api/buses/:busId/profile', authAdmin, async (req, res) => {
  const { plate, plateDisplay, pairingCode } = req.body ?? {};
  let profile;
  if (plate != null) {
    profile = await setBusProfilePlate(req.params.busId, plate);
  } else {
    profile = await upsertBusProfile(req.params.busId, {
      ...(plateDisplay != null ? { plateDisplay: String(plateDisplay).trim() } : {}),
      ...(pairingCode != null ? { pairingCode: String(pairingCode).replace(/\D/g, '').slice(0, 4) } : {}),
    });
  }
  await enqueueCommand(req.params.busId, 'MERGE_STATE', {
    busProfile: {
      plate: profile.plate,
      plateDisplay: profile.plateDisplay,
      pairingCode: profile.pairingCode,
    },
    savedAt: Date.now(),
  });
  res.json({ ok: true, profile });
});

app.post('/api/driver/pair', async (req, res) => {
  const { driverId, plateOrCode } = req.body ?? {};
  const result = await pairDriver(String(driverId ?? '').trim(), plateOrCode);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/driver/unlink', async (req, res) => {
  const { driverId } = req.body ?? {};
  const result = await unlinkDriver(String(driverId ?? '').trim());
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.get('/api/driver/session', async (req, res) => {
  const driverId = String(req.query.driverId ?? '').trim();
  const session = await getDriverSession(driverId);
  if (session.error && !session.linked) {
    res.status(400).json(session);
    return;
  }
  res.json(session);
});

app.post('/api/buses/:busId/unlink-driver', authAdmin, async (req, res) => {
  const result = await unlinkDriverByBusId(req.params.busId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/buses/:busId/telemetry', authBus, async (req, res) => {
  const busId = req.params.busId;
  const { telemetry, state, displaySnapshot } = req.body ?? {};
  await upsertBusTelemetry(busId, { telemetry, state, displaySnapshot });
  res.json({ ok: true });
});

app.get('/api/buses/:busId/commands', authBus, async (req, res) => {
  const commands = await pullPendingCommands(req.params.busId);
  res.json({ ok: true, commands });
});

app.post('/api/buses/:busId/commands/:commandId/ack', authBus, async (req, res) => {
  const cmd = await ackCommand(req.params.commandId);
  res.json({ ok: true, command: cmd });
});

app.post('/api/buses/:busId/ads', authAdmin, async (req, res) => {
  const { ads, bannerAds } = req.body ?? {};
  const cmd = await enqueueCommand(req.params.busId, 'UPDATE_ADS', {
    ...(ads ? { ads } : {}),
    ...(bannerAds ? { bannerAds } : {}),
    savedAt: Date.now(),
  });
  res.json({ ok: true, queued: true, commandId: cmd.id });
});

app.post('/api/buses/:busId/command', authAdmin, async (req, res) => {
  const patch = req.body?.patch;
  if (!patch || typeof patch !== 'object') {
    res.status(400).json({ ok: false, error: 'Missing patch object' });
    return;
  }
  const cmd = await enqueueCommand(req.params.busId, 'MERGE_STATE', {
    ...patch,
    savedAt: Date.now(),
  });
  res.json({ ok: true, queued: true, commandId: cmd.id });
});

app.post('/api/buses/:busId/assign-route', authAdmin, async (req, res) => {
  const routeId = req.body?.routeId;
  const route = await getRouteById(routeId);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Route not found' });
    return;
  }
  const cmd = await enqueueCommand(req.params.busId, 'ASSIGN_ROUTE', {
    route: {
      id: route.id,
      name: route.name,
      startStop: route.startStop,
      endStop: route.endStop,
      stops: route.stops ?? [],
    },
    activeRouteId: route.id,
    savedAt: Date.now(),
  });
  res.json({ ok: true, commandId: cmd.id, route });
});

/** Push route to bus without resetting trip (merge into routes list). */
app.post('/api/buses/:busId/push-route', authAdmin, async (req, res) => {
  const routeId = req.body?.routeId ?? req.body?.route?.id;
  let route = req.body?.route ?? (routeId ? await getRouteById(routeId) : null);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Route not found' });
    return;
  }
  const cmd = await enqueueCommand(req.params.busId, 'UPSERT_ROUTE', {
    route: normalizeRoute(route),
    savedAt: Date.now(),
  });
  res.json({ ok: true, commandId: cmd.id, route });
});

/** Push stop audio / announcement fragments to bus (queued until bus is online). */
app.post('/api/buses/:busId/push-audio', authAdmin, async (req, res) => {
  const { stopAudio, audioFragments, mediaFiles } = req.body ?? {};
  const cmd = await enqueueCommand(req.params.busId, 'MERGE_STATE', {
    ...(stopAudio ? { stopAudio } : {}),
    ...(audioFragments ? { audioFragments } : {}),
    ...(Array.isArray(mediaFiles) ? { mediaFiles } : {}),
    savedAt: Date.now(),
  });
  res.json({ ok: true, commandId: cmd.id });
});

/** Shared phrase clips for all buses (attention, next stop, etc.). */
app.get('/api/announcements/phrases', authBus, async (_req, res) => {
  const payload = await getGlobalPhraseAudio();
  res.json({ ok: true, ...payload });
});

app.put('/api/announcements/phrases', authAdmin, async (req, res) => {
  const { audioFragments, mediaFiles } = req.body ?? {};
  const payload = await setGlobalPhraseAudio(audioFragments, mediaFiles);
  res.json({ ok: true, ...payload });
});

/** Full route + stops save to catalog and optional push to bus. */
app.post('/api/routes', authAdmin, async (req, res) => {
  const route = normalizeRoute(req.body ?? {});
  await upsertRouteCatalog(route);
  for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
    if (stop?.en) await upsertStopCatalog(stop);
  }
  const targetBusIds = req.body?.targetBusIds ?? [];
  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'UPSERT_ROUTE', { route, savedAt: Date.now() });
  }
  res.json({ ok: true, route, queuedFor: targetBusIds });
});

app.put('/api/routes/:routeId', authAdmin, async (req, res) => {
  const route = normalizeRoute({ ...req.body, id: req.params.routeId });
  await upsertRouteCatalog(route);
  for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
    if (stop?.en) await upsertStopCatalog(stop);
  }
  const targetBusIds = req.body?.targetBusIds ?? [];
  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'UPSERT_ROUTE', { route, savedAt: Date.now() });
  }
  res.json({ ok: true, route, queuedFor: targetBusIds });
});

app.delete('/api/routes/:routeId', authAdmin, async (req, res) => {
  const ok = await deleteRouteFromCatalog(req.params.routeId);
  if (!ok) {
    res.status(404).json({ ok: false, error: 'Route not found' });
    return;
  }
  const targetBusIds = req.body?.targetBusIds ?? [];
  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'DELETE_ROUTE', {
      routeId: req.params.routeId,
      savedAt: Date.now(),
    });
  }
  res.json({ ok: true, deleted: req.params.routeId, queuedFor: targetBusIds });
});

app.get('/api/routes', authAdmin, async (_req, res) => {
  const routes = await listAllRoutes();
  res.json({ ok: true, routes });
});

app.get('/api/routes/search', authAdmin, async (req, res) => {
  const routes = await searchRoutes(String(req.query.q ?? ''));
  res.json({ ok: true, routes });
});

app.get('/api/routes/match', authAdmin, async (req, res) => {
  const matches = await matchRoutesByEndpoints(
    String(req.query.start ?? ''),
    String(req.query.end ?? '')
  );
  res.json({ ok: true, matches });
});

app.get('/api/routes/:routeId', authAdmin, async (req, res) => {
  const route = await getRouteById(req.params.routeId);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  res.json({ ok: true, route });
});

app.get('/api/stops/search', authAdmin, async (req, res) => {
  await ensureStopCatalogFromRoutes();
  const stops = await searchStopCatalog(String(req.query.q ?? ''));
  res.json({ ok: true, stops });
});

app.get('/api/stops', authAdmin, async (_req, res) => {
  await ensureStopCatalogFromRoutes();
  const store = await loadStore();
  res.json({ ok: true, stops: store.stopCatalog ?? [] });
});

app.post('/api/stops', authAdmin, async (req, res) => {
  const stop = await upsertStopCatalog(req.body ?? {});
  if (!stop) {
    res.status(400).json({ ok: false, error: 'Stop name required' });
    return;
  }
  res.json({ ok: true, stop });
});

app.get('/api/content-gaps', authAdmin, async (_req, res) => {
  const store = await loadStore();
  const gaps = scanCatalogGaps(store.routeCatalog, store.buses);
  res.json({ ok: true, gaps });
});

app.patch('/api/routes/:routeId/stops/:stopEn', authAdmin, async (req, res) => {
  const { targetBusIds = [], ...stopPatch } = req.body ?? {};
  const route = await patchStopInCatalog(req.params.routeId, req.params.stopEn, stopPatch);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Route or stop not found' });
    return;
  }

  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'PATCH_STOP', {
      routeId: req.params.routeId,
      stopEn: req.params.stopEn,
      patch: stopPatch,
      savedAt: Date.now(),
    });
  }

  res.json({ ok: true, route, queuedFor: targetBusIds });
});

/** Admin upload voice/audio — stored on cloud, bus downloads when online. */
app.post('/api/media/upload', authAdmin, async (req, res) => {
  const category = req.body?.category ?? 'stops';
  const allowed = new Set(['announcements', 'stops', 'ads', 'banners']);
  if (!allowed.has(category)) {
    res.status(400).json({ ok: false, error: 'Invalid category' });
    return;
  }

  const { data, filename } = req.body ?? {};
  if (!data || !filename) {
    res.status(400).json({ ok: false, error: 'Missing data or filename' });
    return;
  }

  const base64 = data.includes(',') ? data.split(',')[1] : data;
  const buffer = Buffer.from(base64, 'base64');
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  const relPath = `${category}/${Date.now()}-${safeName}`;
  const fullPath = path.join(MEDIA_DIR, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);

  res.json({ ok: true, path: relPath, audioFile: relPath });
});

/** Bus pulls missing media from cloud when internet is available. */
app.get('/api/media/:category/:filename', authBus, async (req, res) => {
  const relPath = `${req.params.category}/${req.params.filename}`;
  if (!relPath || relPath.includes('..')) {
    res.status(403).end();
    return;
  }
  const fullPath = path.join(MEDIA_DIR, relPath);
  if (!existsSync(fullPath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(fullPath);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  AdKerala Cloud Admin v3`);
  console.log(`  Listening: http://${HOST}:${PORT}/`);
  console.log(`  Data dir:  ${DATA_DIR}`);
  console.log(`  Health:    GET /api/health\n`);
});
