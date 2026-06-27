import express from 'express';
import cookieParser from 'cookie-parser';
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
  warmUpStore,
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
import {
  CLOUD_VERSION,
  buildPcLatestYml,
  getFleetVersions,
  getReleaseConfig,
  setDriverRelease,
  setMinVersions,
  setPcRelease,
} from './releases.js';
import {
  authSession,
  requireAuth,
  requireRole,
  authCatalog,
  signToken,
  getCookieName,
  getCookieOptions,
  sanitizeUser,
  canAccessBus,
} from './auth.js';
import {
  bootstrapAdminIfNeeded,
  createUser,
  authenticateUser,
  findUserById,
  listUsers,
  updateUser,
  registerBus,
  getDriverAccountSession,
  linkDriverToUser,
} from './users.js';
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  pushCampaignToBuses,
} from './campaigns.js';

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
app.use(cookieParser());

async function assertBusAccess(req, res, busId) {
  const profile = await getBusProfile(busId);
  if (!canAccessBus(req.user, busId, profile)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

function authAdmin(req, res, next) {
  authSession(req, res, () => {
    if (!req.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    next();
  });
}

function authAdminOnly(req, res, next) {
  authSession(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(req.user ? 403 : 401).json({ ok: false, error: req.user ? 'Forbidden' : 'Unauthorized' });
      return;
    }
    next();
  });
}

function authFleet(req, res, next) {
  authSession(req, res, () => {
    if (!req.user || !['admin', 'bus_owner'].includes(req.user.role)) {
      res.status(req.user ? 403 : 401).json({ ok: false, error: req.user ? 'Forbidden' : 'Unauthorized' });
      return;
    }
    next();
  });
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

/* ——— Auth ——— */

app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, role } = req.body ?? {};
  const result = await createUser({ email, password, name, role });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  const token = signToken(result.user);
  res.cookie(getCookieName(), token, getCookieOptions());
  res.json({ ok: true, user: result.user });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const result = await authenticateUser(email, password);
  if (!result.ok) {
    res.status(401).json(result);
    return;
  }
  const token = signToken(result.user);
  res.cookie(getCookieName(), token, getCookieOptions());
  res.json({ ok: true, user: result.user });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(getCookieName(), { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', authSession, requireAuth, async (req, res) => {
  if (req.user.legacy) {
    res.json({ ok: true, user: req.user });
    return;
  }
  const user = await findUserById(req.user.id);
  if (!user || user.status !== 'active') {
    res.status(401).json({ ok: false, error: 'Account inactive' });
    return;
  }
  res.json({ ok: true, user: sanitizeUser(user) });
});

app.get('/api/users', authAdminOnly, async (_req, res) => {
  const users = await listUsers();
  res.json({ ok: true, users });
});

app.patch('/api/users/:userId', authAdminOnly, async (req, res) => {
  const result = await updateUser(req.params.userId, req.body ?? {});
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/buses/register', authFleet, async (req, res) => {
  const { busId, plate } = req.body ?? {};
  const ownerId = req.user.role === 'bus_owner' ? req.user.id : req.body?.ownerId ?? null;
  const result = await registerBus({ busId, plate, ownerId });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.get('/api/campaigns', authSession, requireAuth, async (req, res) => {
  if (!['admin', 'advertiser', 'bus_owner'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const campaigns = await listCampaigns(req.user);
  res.json({ ok: true, campaigns });
});

app.post('/api/campaigns', authSession, requireAuth, requireRole('admin', 'advertiser'), async (req, res) => {
  const result = await createCampaign(req.user, req.body ?? {});
  res.json(result);
});

app.put('/api/campaigns/:id', authSession, requireAuth, requireRole('admin', 'advertiser'), async (req, res) => {
  const result = await updateCampaign(req.params.id, req.user, req.body ?? {});
  if (!result.ok) {
    res.status(result.error === 'Forbidden' ? 403 : 404).json(result);
    return;
  }
  res.json(result);
});

app.delete('/api/campaigns/:id', authSession, requireAuth, requireRole('admin', 'advertiser'), async (req, res) => {
  const result = await deleteCampaign(req.params.id, req.user);
  if (!result.ok) {
    res.status(result.error === 'Forbidden' ? 403 : 404).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/campaigns/:id/push', authSession, requireAuth, requireRole('admin', 'bus_owner'), async (req, res) => {
  const store = await loadStore();
  const result = await pushCampaignToBuses(req.params.id, req.user, store.busProfiles);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/campaigns/:id/approve', authAdminOnly, async (req, res) => {
  const result = await updateCampaign(req.params.id, req.user, { status: 'active' });
  if (!result.ok) {
    res.status(404).json(result);
    return;
  }
  res.json(result);
});

app.get('/api/driver/account', authSession, requireAuth, requireRole('driver'), async (req, res) => {
  const session = await getDriverAccountSession(req.user.id);
  res.json(session);
});

app.post('/api/driver/link-account', authSession, requireAuth, requireRole('driver'), async (req, res) => {
  const { driverId } = req.body ?? {};
  const result = await linkDriverToUser(String(driverId ?? '').trim(), req.user.id);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

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
  res.json({
    ok: true,
    service: 'adkerala-cloud',
    version: CLOUD_VERSION,
  });
});

app.get('/api/health/details', async (_req, res) => {
  try {
    const releases = await getReleaseConfig();
    res.json({
      ok: true,
      service: 'adkerala-cloud',
      version: CLOUD_VERSION,
      minPcVersion: releases.minPcVersion,
      minDriverVersion: releases.minDriverVersion,
      latestPcVersion: releases.pc?.version ?? null,
      latestDriverVersion: releases.driver?.version ?? null,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

app.get('/api/buses', authSession, requireAuth, async (req, res) => {
  if (req.user.role === 'advertiser') {
    const buses = await listBuses({});
    res.json({ ok: true, buses: buses.map((b) => ({ busId: b.busId })) });
    return;
  }
  if (!['admin', 'bus_owner'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const ownerId = req.user.role === 'bus_owner' ? req.user.id : null;
  const buses = await listBuses({ ownerId });
  res.json({ ok: true, buses });
});

app.get('/api/buses/:busId/telemetry', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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

app.put('/api/buses/:busId/profile', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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

app.post('/api/buses/:busId/unlink-driver', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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

app.post('/api/buses/:busId/ads', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const { ads, bannerAds } = req.body ?? {};
  const cmd = await enqueueCommand(req.params.busId, 'UPDATE_ADS', {
    ...(ads ? { ads } : {}),
    ...(bannerAds ? { bannerAds } : {}),
    savedAt: Date.now(),
  });
  res.json({ ok: true, queued: true, commandId: cmd.id });
});

app.post('/api/buses/:busId/command', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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

app.post('/api/buses/:busId/assign-route', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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
app.post('/api/buses/:busId/push-route', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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
app.post('/api/buses/:busId/push-audio', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
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

app.get('/api/announcements/phrases/catalog', authCatalog, async (_req, res) => {
  const payload = await getGlobalPhraseAudio();
  res.json({ ok: true, ...payload });
});

app.put('/api/announcements/phrases', authCatalog, async (req, res) => {
  const { audioFragments, mediaFiles } = req.body ?? {};
  const payload = await setGlobalPhraseAudio(audioFragments, mediaFiles);
  res.json({ ok: true, ...payload });
});

/** Full route + stops save to catalog and optional push to bus. */
app.post('/api/routes', authCatalog, async (req, res) => {
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

app.put('/api/routes/:routeId', authCatalog, async (req, res) => {
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

app.delete('/api/routes/:routeId', authCatalog, async (req, res) => {
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

app.get('/api/routes', authCatalog, async (_req, res) => {
  const routes = await listAllRoutes();
  res.json({ ok: true, routes });
});

app.get('/api/routes/search', authCatalog, async (req, res) => {
  const routes = await searchRoutes(String(req.query.q ?? ''));
  res.json({ ok: true, routes });
});

app.get('/api/routes/match', authCatalog, async (req, res) => {
  const matches = await matchRoutesByEndpoints(
    String(req.query.start ?? ''),
    String(req.query.end ?? '')
  );
  res.json({ ok: true, matches });
});

app.get('/api/routes/:routeId', authCatalog, async (req, res) => {
  const route = await getRouteById(req.params.routeId);
  if (!route) {
    res.status(404).json({ ok: false, error: 'Not found' });
    return;
  }
  res.json({ ok: true, route });
});

app.get('/api/stops/search', authCatalog, async (req, res) => {
  await ensureStopCatalogFromRoutes();
  const stops = await searchStopCatalog(String(req.query.q ?? ''));
  res.json({ ok: true, stops });
});

app.get('/api/stops', authCatalog, async (_req, res) => {
  await ensureStopCatalogFromRoutes();
  const store = await loadStore();
  res.json({ ok: true, stops: store.stopCatalog ?? [] });
});

app.post('/api/stops', authCatalog, async (req, res) => {
  const stop = await upsertStopCatalog(req.body ?? {});
  if (!stop) {
    res.status(400).json({ ok: false, error: 'Stop name required' });
    return;
  }
  res.json({ ok: true, stop });
});

app.get('/api/content-gaps', authCatalog, async (_req, res) => {
  const store = await loadStore();
  const gaps = scanCatalogGaps(store.routeCatalog, store.buses);
  res.json({ ok: true, gaps });
});

app.patch('/api/routes/:routeId/stops/:stopEn', authCatalog, async (req, res) => {
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
app.post('/api/media/upload', authSession, requireAuth, async (req, res) => {
  if (!['admin', 'bus_owner', 'advertiser'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
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

/** ——— Remote release / fleet version APIs ——— */

app.get('/api/releases', authAdminOnly, async (_req, res) => {
  const config = await getReleaseConfig();
  const fleet = await getFleetVersions();
  res.json({ ok: true, ...config, cloudVersion: CLOUD_VERSION, fleet: fleet.buses });
});

app.get('/api/releases/fleet', authAdminOnly, async (_req, res) => {
  const fleet = await getFleetVersions();
  res.json({ ok: true, ...fleet });
});

app.put('/api/releases/pc', authAdminOnly, async (req, res) => {
  const { version, downloadUrl, sha512, size, releaseNotes } = req.body ?? {};
  if (!version || !downloadUrl) {
    res.status(400).json({ ok: false, error: 'version and downloadUrl required' });
    return;
  }
  const pc = await setPcRelease({ version, downloadUrl, sha512, size, releaseNotes });
  res.json({ ok: true, pc });
});

app.put('/api/releases/driver', authAdminOnly, async (req, res) => {
  const { version, downloadUrl, releaseNotes } = req.body ?? {};
  if (!version || !downloadUrl) {
    res.status(400).json({ ok: false, error: 'version and downloadUrl required' });
    return;
  }
  const driver = await setDriverRelease({ version, downloadUrl, releaseNotes });
  res.json({ ok: true, driver });
});

app.put('/api/releases/min-versions', authAdminOnly, async (req, res) => {
  const releases = await setMinVersions(req.body ?? {});
  res.json({ ok: true, releases });
});

/** electron-updater generic feed — public read */
app.get('/api/releases/pc/latest.yml', async (_req, res) => {
  const config = await getReleaseConfig();
  const yml = buildPcLatestYml(config.pc);
  if (!yml) {
    res.status(404).type('text/plain').send('No PC release registered');
    return;
  }
  res.type('text/yaml').send(yml);
});

app.get('/api/releases/pc/latest', async (_req, res) => {
  const config = await getReleaseConfig();
  res.json({
    ok: true,
    release: config.pc,
    minVersion: config.minPcVersion,
  });
});

/** Driver APK update check — public read */
app.get('/api/releases/driver/latest', async (_req, res) => {
  const config = await getReleaseConfig();
  res.json({
    ok: true,
    release: config.driver,
    minVersion: config.minDriverVersion,
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await warmUpStore();
  await bootstrapAdminIfNeeded();
  app.listen(PORT, HOST, () => {
    console.log(`\n  AdKerala Cloud Admin v${CLOUD_VERSION}`);
    console.log(`  Listening: http://${HOST}:${PORT}/`);
    console.log(`  Data dir:  ${DATA_DIR}`);
    console.log(`  Health:    GET /api/health\n`);
  });
}

start().catch((err) => {
  console.error('Failed to start cloud server:', err);
  process.exit(1);
});
