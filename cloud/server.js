import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  upsertBusTelemetry,
  getBus,
  listBuses,
  enqueueCommand,
  pullPendingCommands,
  ackCommand,
  searchRoutes,
  getRouteById,
  patchStopInCatalog,
  loadStore,
  scanCatalogGaps,
} from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const ADMIN_KEY = process.env.ADKERALA_ADMIN_KEY ?? 'change-me-in-production';

if (ADMIN_KEY === 'change-me-in-production' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Set ADKERALA_ADMIN_KEY in production!');
}

const app = express();
app.use(express.json({ limit: '10mb' }));

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'adkerala-cloud', version: 2 });
});

app.get('/api/buses', authAdmin, async (_req, res) => {
  const buses = await listBuses();
  res.json({ ok: true, buses });
});

app.get('/api/buses/:busId/telemetry', authAdmin, async (req, res) => {
  const row = await getBus(req.params.busId);
  if (!row) {
    res.json({ ok: true, online: false, telemetry: null, state: null, displaySnapshot: null });
    return;
  }
  const online = Date.now() - row.updatedAt < 15000;
  res.json({
    ok: true,
    online,
    telemetry: row.telemetry,
    state: row.state,
    displaySnapshot: row.displaySnapshot,
    updatedAt: row.updatedAt,
  });
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

app.get('/api/routes/search', authAdmin, async (req, res) => {
  const routes = await searchRoutes(String(req.query.q ?? ''));
  res.json({ ok: true, routes });
});

app.get('/api/routes/:routeId', authAdmin, async (req, res) => {
  const route = await getRouteById(req.params.routeId);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  res.json({ ok: true, route });
});

app.get('/api/content-gaps', authAdmin, async (_req, res) => {
  const store = await loadStore();
  const gaps = scanCatalogGaps(store.routeCatalog, store.buses);
  res.json({ ok: true, gaps });
});

app.patch('/api/routes/:routeId/stops/:stopEn', authAdmin, async (req, res) => {
  const route = await patchStopInCatalog(req.params.routeId, req.params.stopEn, req.body ?? {});
  if (!route) {
    res.status(404).json({ ok: false, error: 'Route or stop not found' });
    return;
  }

  const targetBusIds = req.body?.targetBusIds ?? [];
  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'PATCH_STOP', {
      routeId: req.params.routeId,
      stopEn: req.params.stopEn,
      patch: req.body,
      savedAt: Date.now(),
    });
  }

  res.json({ ok: true, route, queuedFor: targetBusIds });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`\n  AdKerala Cloud Admin v2`);
  console.log(`  Listening: http://${HOST}:${PORT}/`);
  console.log(`  Data dir:  ${process.env.DATA_DIR || '(default cloud/data)'}`);
  console.log(`  Health:    GET /api/health\n`);
});
