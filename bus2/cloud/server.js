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
  saveStore,
  warmUpStore,
  scanCatalogGaps,
  getGlobalPhraseAudio,
  setGlobalPhraseAudio,
  getStopAudioCatalog,
  mergeStopAudioCatalog,
  getStopAudioForRoute,
  getBusAdsCatalog,
  setBusAdsCatalog,
  syncBusAdsCatalogFromTelemetry,
  getBusProfile,
  setBusProfilePlate,
  upsertBusProfile,
  pairDriver,
  unlinkDriver,
  unlinkDriverByBusId,
  getDriverSession,
  deleteBus,
  updateDriverLocation,
  getLocationHistory,
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
import {
  enrollDevice,
  getEnrollmentStatus,
  claimBusByCode,
  listPendingEnrollments,
  revokeBusDevice,
  verifyBusDeviceToken,
  findBusIdByDeviceToken,
  withMediaFiles,
} from './fleet.js';
import { enrollLimiter, pairLimiter, authLimiter, locationLimiter } from './middleware/rateLimit.js';
import { requestLogger, writeAudit } from './logger.js';
import { verifyR2Config, uploadMediaBuffer, getPublicMediaUrl, deleteMediaFile } from './mediaStorage.js';
import { collectAdMediaPathsFromLists, collectRemovedAdMediaPaths } from './adsCatalog.js';
import { usePostgres, getPool } from './db/pool.js';
import { getPublicConfig, getPublicUrl, getCloudUrls } from './config.js';
import {
  getOwnerDriverOtp,
  refreshOwnerDriverOtp,
  verifyDriverControlForBus,
} from './driverOtp.js';

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
app.set('trust proxy', 1);
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());
app.use(requestLogger);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = Boolean(origin && getCloudUrls().includes(origin.replace(/\/+$/, '')));
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS' && allowed) {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, X-Bus-Key, X-Bus-Token');
    res.status(204).end();
    return;
  }
  next();
});

const ONLINE_MS = Number(process.env.ADKERALA_ONLINE_MS ?? 20000);

async function assertBusAccess(req, res, busId) {
  const profile = await getBusProfile(busId);
  if (!canAccessBus(req.user, busId, profile)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

async function resolveTargetBusIds(req, targetBusIds) {
  const ownerId = req.user.role === 'bus_owner' ? req.user.id : null;
  const allBuses = await listBuses({ ownerId });
  let ids = targetBusIds;
  if (ids === 'all' || (Array.isArray(ids) && ids.length === 1 && ids[0] === 'all')) {
    ids = allBuses.map((b) => b.busId);
  }
  if (!Array.isArray(ids) || !ids.length) return [];
  const allowed = [];
  for (const busId of ids) {
    const profile = await getBusProfile(busId);
    if (canAccessBus(req.user, busId, profile)) allowed.push(busId);
  }
  return allowed;
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
  const busToken = req.headers['x-bus-token'] ?? '';
  const busId = req.params.busId ?? req.body?.busId ?? null;

  if (busToken) {
    verifyBusDeviceToken(busId, busToken).then((valid) => {
      if (!valid) {
        findBusIdByDeviceToken(busToken).then((resolvedBusId) => {
          if (resolvedBusId && (!busId || resolvedBusId === busId)) {
            req.busId = resolvedBusId;
            next();
            return;
          }
          res.status(401).json({ ok: false, error: 'Invalid bus token' });
        });
        return;
      }
      req.busId = busId;
      next();
    });
    return;
  }

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

app.post('/api/auth/login', authLimiter, async (req, res) => {
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
  res.json({ ok: true, busId: result.busId ?? busId, profile: result.profile });
});

app.post('/api/fleet/enroll', enrollLimiter, async (req, res) => {
  const { installId, fleetClaimCode, appVersion } = req.body ?? {};
  const result = await enrollDevice({ installId, fleetClaimCode, appVersion });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.get('/api/fleet/enroll/:installId/status', enrollLimiter, async (req, res) => {
  const result = await getEnrollmentStatus(req.params.installId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/fleet/claim', authSession, requireAuth, requireRole('admin', 'bus_owner'), async (req, res) => {
  try {
    const { fleetClaimCode, plate, installId } = req.body ?? {};
    const ownerId = req.user.role === 'bus_owner' ? req.user.id : req.body?.ownerId ?? req.user.id;
    const result = await claimBusByCode({
      fleetClaimCode,
      plate,
      ownerId,
      installId,
      admin: req.user.role === 'admin',
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('Fleet claim failed:', err);
    res.status(500).json({ ok: false, error: err.message ?? 'Claim failed' });
  }
});

app.get('/api/fleet/pending', authSession, requireAuth, requireRole('admin', 'bus_owner'), async (req, res) => {
  const ownerId = req.user.role === 'bus_owner' ? req.user.id : null;
  const pending = await listPendingEnrollments({ ownerId });
  res.json({ ok: true, pending });
});

app.post('/api/fleet/revoke/:busId', authSession, requireAuth, requireRole('admin', 'bus_owner'), async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const ownerId = req.user.role === 'bus_owner' ? req.user.id : null;
  const result = await revokeBusDevice(req.params.busId, {
    ownerId,
    admin: req.user.role === 'admin',
  });
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

function resolveFleetOwnerId(req, explicitOwnerId) {
  if (req.user.role === 'bus_owner') return req.user.id;
  return explicitOwnerId || 'platform';
}

app.get('/api/fleet/driver-otp', authFleet, async (req, res) => {
  const ownerId = resolveFleetOwnerId(req, req.query.ownerId);
  const entry = await getOwnerDriverOtp(ownerId);
  res.json({ ok: true, otp: entry.otp, updatedAt: entry.updatedAt, ownerId: entry.ownerId });
});

app.post('/api/fleet/driver-otp/refresh', authFleet, async (req, res) => {
  const ownerId = resolveFleetOwnerId(req, req.body?.ownerId);
  const entry = await refreshOwnerDriverOtp(ownerId);
  await writeAudit('fleet.driver_otp.refresh', req.user.id, { ownerId: entry.ownerId });
  res.json({ ok: true, otp: entry.otp, updatedAt: entry.updatedAt, ownerId: entry.ownerId });
});

app.post('/api/buses/:busId/verify-driver-control', authBus, async (req, res) => {
  const busId = req.busId ?? req.params.busId;
  const { pairingCode, otp } = req.body ?? {};
  const result = await verifyDriverControlForBus(busId, pairingCode, otp);
  if (!result.ok) {
    res.status(403).json(result);
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

function collectAudioMediaPaths(...maps) {
  const paths = new Set();
  for (const map of maps) {
    if (!map) continue;
    for (const entry of Object.values(map)) {
      for (const lang of Object.values(entry ?? {})) {
        const file = lang?.audioFile;
        if (file && typeof file === 'string') paths.add(file);
      }
    }
  }
  return [...paths];
}

async function mergeStopWithCatalog(stop) {
  if (!stop?.en) return stop;
  const catalog = await getStopFromCatalog(stop.en);
  if (!catalog) return stop;
  return {
    ...stop,
    ml: stop.ml || catalog.ml || '',
    lat: stop.lat ?? catalog.lat ?? null,
    lng: stop.lng ?? catalog.lng ?? null,
    radiusM: stop.radiusM ?? catalog.radiusM ?? 80,
  };
}

/** Fill missing Malayalam/GPS on route stops from the shared cloud catalog. */
async function enrichRouteFromCatalog(route) {
  if (!route) return route;
  return {
    ...route,
    startStop: await mergeStopWithCatalog(route.startStop),
    endStop: await mergeStopWithCatalog(route.endStop),
    stops: await Promise.all((route.stops ?? []).map((s) => mergeStopWithCatalog(s))),
  };
}

function attachStopAudioToRoute(route, stopAudioCatalog = {}) {
  if (!route) return route;
  const attach = (stop) => {
    if (!stop?.en) return stop;
    const key = stop.en.trim().toLowerCase();
    const audioFile = stop.audioEn ?? stopAudioCatalog[key]?.en?.audioFile ?? null;
    if (!audioFile) return stop;
    return { ...stop, audioEn: audioFile };
  };
  return {
    ...route,
    startStop: attach(route.startStop),
    endStop: attach(route.endStop),
    stops: (route.stops ?? []).map(attach),
  };
}

async function enrichRouteForClient(route) {
  const merged = await enrichRouteFromCatalog(route);
  const catalog = await getStopAudioCatalog();
  return attachStopAudioToRoute(merged, catalog.stopAudio ?? {});
}

/** Queue global phrase clips + stop audio from catalog for the bus route. */
async function queueAudioBundleForBus(busId, { routeId = null } = {}) {
  const queued = [];
  const global = await getGlobalPhraseAudio();
  if (global?.audioFragments && Object.keys(global.audioFragments).length) {
    const cmd = await enqueueCommand(busId, 'MERGE_STATE', {
      audioFragments: global.audioFragments,
      mediaFiles: global.mediaFiles ?? [],
      savedAt: Date.now(),
    });
    queued.push(cmd.id);
  }

  const catalog = await getStopAudioCatalog();
  const row = await getBus(busId);
  const activeRouteId =
    routeId ?? row?.state?.activeRouteId ?? row?.telemetry?.activeRouteId ?? null;

  let stopAudio = {};
  if (activeRouteId) {
    const route = await getRouteById(activeRouteId);
    if (route) {
      stopAudio = getStopAudioForRoute(route, catalog.stopAudio ?? {});
    }
  }
  if (!Object.keys(stopAudio).length && row?.state?.stopAudio) {
    stopAudio = row.state.stopAudio;
  }

  if (stopAudio && Object.keys(stopAudio).length) {
    const mediaFiles = collectAudioMediaPaths(stopAudio);
    const cmd = await enqueueCommand(busId, 'MERGE_STATE', {
      stopAudio,
      ...(mediaFiles.length ? { mediaFiles } : {}),
      savedAt: Date.now(),
    });
    queued.push(cmd.id);
  }

  return queued;
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'adkerala-cloud',
    version: CLOUD_VERSION,
    publicUrl: getPublicUrl(),
  });
});

app.get('/api/public/config', (_req, res) => {
  res.json({ ok: true, ...getPublicConfig() });
});

app.get('/api/health/details', async (_req, res) => {
  try {
    const releases = await getReleaseConfig();
    const buses = await listBuses({});
    const onlineCount = buses.filter((b) => Date.now() - b.updatedAt < ONLINE_MS).length;
    let pgOk = null;
    if (usePostgres()) {
      try {
        await getPool().query('SELECT 1');
        pgOk = true;
      } catch {
        pgOk = false;
      }
    }
    res.json({
      ok: true,
      service: 'adkerala-cloud',
      version: CLOUD_VERSION,
      publicUrl: getPublicUrl(),
      cloudUrls: getCloudUrls(),
      minPcVersion: releases.minPcVersion,
      minDriverVersion: releases.minDriverVersion,
      latestPcVersion: releases.pc?.version ?? null,
      latestDriverVersion: releases.driver?.version ?? null,
      postgres: pgOk,
      r2: verifyR2Config(),
      fleetOnline: onlineCount,
      fleetTotal: buses.length,
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
  const online = Date.now() - row.updatedAt < ONLINE_MS;
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

app.get('/api/buses/:busId/locations', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const minutes = Math.min(Math.max(Number(req.query.minutes) || 120, 5), 24 * 60);
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 10), 2000);
  const points = await getLocationHistory(req.params.busId, { minutes, limit });
  res.json({ ok: true, busId: req.params.busId, points });
});

app.put('/api/buses/:busId/profile', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const { plate, plateDisplay, pairingCode, displayName } = req.body ?? {};
  let profile;
  if (plate != null) {
    profile = await setBusProfilePlate(req.params.busId, plate);
    if (displayName != null) {
      profile = await upsertBusProfile(req.params.busId, {
        displayName: String(displayName).trim().slice(0, 80),
      });
    }
  } else {
    profile = await upsertBusProfile(req.params.busId, {
      ...(plateDisplay != null ? { plateDisplay: String(plateDisplay).trim() } : {}),
      ...(displayName != null ? { displayName: String(displayName).trim().slice(0, 80) } : {}),
      ...(pairingCode != null ? { pairingCode: String(pairingCode).replace(/\D/g, '').slice(0, 4) } : {}),
    });
  }
  await enqueueCommand(req.params.busId, 'MERGE_STATE', {
    busProfile: {
      plate: profile.plate,
      plateDisplay: profile.plateDisplay,
      displayName: profile.displayName ?? '',
      pairingCode: profile.pairingCode,
    },
    savedAt: Date.now(),
  });
  res.json({ ok: true, profile });
});

app.delete('/api/buses/:busId', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const result = await deleteBus(req.params.busId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  await writeAudit('fleet.bus.delete', req.user.id, { busId: req.params.busId });
  res.json(result);
});

app.post('/api/driver/pair', pairLimiter, async (req, res) => {
  const { driverId, plateOrCode } = req.body ?? {};
  const result = await pairDriver(String(driverId ?? '').trim(), plateOrCode);
  if (!result.ok) {
    await writeAudit('driver.pair.failed', driverId, { plateOrCode, error: result.error });
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/driver/heartbeat', async (req, res) => {
  const { driverId, appVersion } = req.body ?? {};
  const id = String(driverId ?? '').trim();
  if (!id) {
    res.status(400).json({ ok: false, error: 'Missing driverId' });
    return;
  }
  const store = await loadStore();
  if (!store.drivers) store.drivers = {};
  store.drivers[id] = {
    ...(store.drivers[id] ?? {}),
    appVersion: String(appVersion ?? '').trim() || store.drivers[id]?.appVersion,
    lastSeenAt: Date.now(),
  };
  await saveStore();
  if (usePostgres()) {
    await getPool().query(
      `INSERT INTO drivers (driver_id, app_version, last_seen_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (driver_id) DO UPDATE SET app_version = EXCLUDED.app_version, last_seen_at = EXCLUDED.last_seen_at`,
      [id, store.drivers[id].appVersion ?? null, Date.now()]
    );
  }
  res.json({ ok: true });
});

app.post('/api/driver/location', locationLimiter, async (req, res) => {
  const { driverId, location } = req.body ?? {};
  const result = await updateDriverLocation(String(driverId ?? '').trim(), location ?? {});
  if (!result.ok) {
    res.status(result.error === 'Driver not linked to a bus' ? 403 : 400).json(result);
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
  const adsSavedAt = Date.now();
  const catalog = await setBusAdsCatalog(req.params.busId, {
    ads: ads ?? [],
    bannerAds: bannerAds ?? [],
    adsSavedAt,
    source: 'dashboard',
  });
  const cmd = await enqueueCommand(
    req.params.busId,
    'UPDATE_ADS',
    withMediaFiles({
      ads: catalog.ads,
      bannerAds: catalog.bannerAds,
      adsSavedAt: catalog.adsSavedAt,
      savedAt: adsSavedAt,
    })
  );
  res.json({ ok: true, queued: true, commandId: cmd.id, catalog });
});

app.get('/api/buses/:busId/ads/catalog', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const row = await getBus(req.params.busId);
  await syncBusAdsCatalogFromTelemetry(req.params.busId, row?.state ?? {});
  const catalog = await getBusAdsCatalog(req.params.busId);
  res.json({
    ok: true,
    ...catalog,
    mediaFiles: collectAdMediaPathsFromLists(catalog.ads, catalog.bannerAds),
  });
});

app.put('/api/buses/:busId/ads/catalog', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const { ads, bannerAds, push = true } = req.body ?? {};
  const adsSavedAt = Date.now();
  const prev = await getBusAdsCatalog(req.params.busId);
  const catalog = await setBusAdsCatalog(req.params.busId, {
    ads: ads ?? [],
    bannerAds: bannerAds ?? [],
    adsSavedAt,
    source: 'dashboard',
  });
  const removedMedia = collectRemovedAdMediaPaths(
    prev.ads,
    prev.bannerAds,
    catalog.ads,
    catalog.bannerAds
  );
  for (const relPath of removedMedia) {
    try {
      await deleteMediaFile(relPath, MEDIA_DIR);
    } catch (err) {
      console.warn('Ad media delete failed:', relPath, err.message);
    }
  }
  let commandId = null;
  if (push) {
    const cmd = await enqueueCommand(
      req.params.busId,
      'UPDATE_ADS',
      withMediaFiles({
        ads: catalog.ads,
        bannerAds: catalog.bannerAds,
        adsSavedAt: catalog.adsSavedAt,
        savedAt: adsSavedAt,
        ...(removedMedia.length ? { removedMediaFiles: removedMedia } : {}),
      })
    );
    commandId = cmd.id;
  }
  res.json({ ok: true, catalog, queued: Boolean(commandId), commandId, removedMedia });
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
  const route = await enrichRouteFromCatalog(await getRouteById(routeId));
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
      sharedFromCloud: true,
      cloudRouteId: route.id,
    },
    activeRouteId: route.id,
    savedAt: Date.now(),
  });
  const audioCommandIds = await queueAudioBundleForBus(req.params.busId, { routeId: route.id });
  res.json({ ok: true, commandId: cmd.id, audioCommandIds, route });
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
  route = await enrichRouteFromCatalog(normalizeRoute(route));
  const cmd = await enqueueCommand(req.params.busId, 'UPSERT_ROUTE', {
    route: {
      ...route,
      sharedFromCloud: true,
      cloudRouteId: route.id,
    },
    savedAt: Date.now(),
  });
  const audioCommandIds = await queueAudioBundleForBus(req.params.busId, { routeId: route.id });
  res.json({ ok: true, commandId: cmd.id, audioCommandIds, route });
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

/** Queue the same command for multiple buses (fleet-wide push). */
app.post('/api/fleet/broadcast', authFleet, async (req, res) => {
  const { targetBusIds, commandType, payload } = req.body ?? {};
  if (!commandType || typeof commandType !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing commandType' });
    return;
  }
  const busIds = await resolveTargetBusIds(req, targetBusIds);
  if (!busIds.length) {
    res.status(400).json({ ok: false, error: 'No accessible target buses' });
    return;
  }
  const mergedPayload = withMediaFiles({ ...(payload ?? {}), savedAt: Date.now() });
  const commandIds = [];
  for (const busId of busIds) {
    if (commandType === 'UPDATE_ADS' && Array.isArray(payload?.ads) && Array.isArray(payload?.bannerAds)) {
      const adsSavedAt = payload.adsSavedAt ?? mergedPayload.savedAt ?? Date.now();
      await setBusAdsCatalog(busId, {
        ads: payload.ads,
        bannerAds: payload.bannerAds,
        adsSavedAt,
        source: 'dashboard',
      });
      mergedPayload.adsSavedAt = adsSavedAt;
    }
    const cmd = await enqueueCommand(busId, commandType, mergedPayload);
    commandIds.push({ busId, commandId: cmd.id });
  }
  res.json({ ok: true, queuedFor: busIds, commandIds });
});

app.post('/api/buses/:busId/drive', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const action = req.body?.action;
  if (!action || typeof action !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing action' });
    return;
  }
  const { action: _a, ...rest } = req.body ?? {};
  const cmd = await enqueueCommand(req.params.busId, 'DRIVE_ACTION', {
    action,
    ...rest,
    savedAt: Date.now(),
  });
  res.json({ ok: true, queued: true, commandId: cmd.id });
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

/** Per-stop voice clips keyed by English stop name (shared catalog). */
app.get('/api/stops/audio/catalog', authCatalog, async (_req, res) => {
  const payload = await getStopAudioCatalog();
  res.json({ ok: true, ...payload });
});

app.put('/api/stops/audio', authCatalog, async (req, res) => {
  const { stopAudio, mediaFiles } = req.body ?? {};
  const payload = await mergeStopAudioCatalog(stopAudio ?? {}, mediaFiles);
  res.json({ ok: true, ...payload });
});

/** Full route + stops save to catalog and optional push to bus. */
app.post('/api/routes', authCatalog, async (req, res) => {
  const route = normalizeRoute(req.body ?? {});
  await upsertRouteCatalog(route);
  for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
    if (stop?.en) await upsertStopCatalog(stop);
  }
  const enriched = await enrichRouteForClient(route);
  const targetBusIds = req.body?.targetBusIds ?? [];
  for (const busId of targetBusIds) {
    await enqueueCommand(busId, 'UPSERT_ROUTE', { route: await enrichRouteFromCatalog(route), savedAt: Date.now() });
    await queueAudioBundleForBus(busId, { routeId: enriched.id });
  }
  res.json({ ok: true, route: enriched, queuedFor: targetBusIds });
});

app.put('/api/routes/:routeId', authCatalog, async (req, res) => {
  try {
    const route = normalizeRoute({ ...req.body, id: req.params.routeId });
    await upsertRouteCatalog(route);
    for (const stop of [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean)) {
      if (stop?.en) await upsertStopCatalog(stop);
    }
    const enriched = await enrichRouteForClient(route);
    const targetBusIds = req.body?.targetBusIds ?? [];
    for (const busId of targetBusIds) {
      await enqueueCommand(busId, 'UPSERT_ROUTE', { route: await enrichRouteFromCatalog(route), savedAt: Date.now() });
      await queueAudioBundleForBus(busId, { routeId: enriched.id });
    }
    res.json({ ok: true, route: enriched, queuedFor: targetBusIds });
  } catch (err) {
    console.error('PUT /api/routes failed:', err);
    res.status(500).json({ ok: false, error: err.message ?? 'Could not save route' });
  }
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
  try {
    const routes = await listAllRoutes();
    const enriched = await Promise.all(routes.map((r) => enrichRouteForClient(r)));
    res.json({ ok: true, routes: enriched });
  } catch (err) {
    console.error('GET /api/routes failed:', err);
    res.status(500).json({ ok: false, error: err.message ?? 'Could not list routes' });
  }
});

app.get('/api/routes/search', authCatalog, async (req, res) => {
  try {
    const routes = await searchRoutes(String(req.query.q ?? ''));
    res.json({ ok: true, routes });
  } catch (err) {
    console.error('GET /api/routes/search failed:', err);
    res.status(500).json({ ok: false, error: err.message ?? 'Search failed' });
  }
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
  res.json({ ok: true, route: await enrichRouteForClient(route) });
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

let contentGapsCache = { at: 0, gaps: [] };
const CONTENT_GAPS_TTL_MS = 5 * 60 * 1000;

app.get('/api/content-gaps', authCatalog, async (_req, res) => {
  const now = Date.now();
  if (now - contentGapsCache.at < CONTENT_GAPS_TTL_MS) {
    res.json({ ok: true, gaps: contentGapsCache.gaps, cached: true });
    return;
  }
  const routes = await listAllRoutes();
  const store = await loadStore();
  const stopCatalog = await getStopAudioCatalog();
  const gaps = scanCatalogGaps(routes, store.buses ?? {}, stopCatalog.stopAudio ?? {});
  contentGapsCache = { at: now, gaps };
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

  const contentType = req.body?.contentType ?? 'application/octet-stream';
  const base64 = data.includes(',') ? data.split(',')[1] : data;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    res.status(400).json({ ok: false, error: 'Empty file data' });
    return;
  }
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  const relPath = `${category}/${Date.now()}-${safeName}`;
  const fullPath = path.join(MEDIA_DIR, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, buffer);
  await uploadMediaBuffer(relPath, buffer, contentType);

  res.json({
    ok: true,
    path: relPath,
    audioFile: relPath,
    publicUrl: getPublicMediaUrl(relPath),
  });
});

/** Admin removes ad/banner media no longer referenced in catalogs. */
app.delete('/api/media/:category/:filename', authSession, requireAuth, async (req, res) => {
  if (!['admin', 'bus_owner'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const relPath = `${req.params.category}/${req.params.filename}`;
  const result = await deleteMediaFile(relPath, MEDIA_DIR);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error ?? 'Delete failed' });
    return;
  }
  res.json({ ok: true, deleted: relPath, ...result });
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
    const publicUrl = getPublicMediaUrl(relPath);
    if (publicUrl) {
      res.redirect(publicUrl);
      return;
    }
    res.status(404).end();
    return;
  }
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.mp3') || lower.endsWith('.mpeg')) res.type('audio/mpeg');
  else if (lower.endsWith('.wav')) res.type('audio/wav');
  else if (lower.endsWith('.mp4') || lower.endsWith('.webm')) res.type('video/mp4');
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) res.type('image/jpeg');
  else if (lower.endsWith('.png')) res.type('image/png');
  else if (lower.endsWith('.gif')) res.type('image/gif');
  else if (lower.endsWith('.webp')) res.type('image/webp');
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
  const server = app.listen(PORT, HOST, () => {
    console.log(`\n  AdKerala Cloud Admin v${CLOUD_VERSION}`);
    console.log(`  Listening: http://${HOST}:${PORT}/`);
    console.log(`  Public URL: ${getPublicUrl()}`);
    console.log(`  Also served: ${getCloudUrls().filter((u) => u !== getPublicUrl()).join(', ') || '(none)'}`);
    console.log(`  Data dir:  ${DATA_DIR}`);
    console.log(`  Health:    GET /api/health\n`);
  });

  try {
    await warmUpStore();
    await bootstrapAdminIfNeeded();
    if (usePostgres()) {
      const store = await loadStore();
      const { pgUpsertUser } = await import('./usersPg.js');
      for (const user of Object.values(store.users ?? {})) {
        await pgUpsertUser(user);
      }
      setInterval(() => {
        import('./storePg.js').then((m) => m.pgPruneCommands()).catch(() => {});
      }, 60 * 60 * 1000);
    }
  } catch (err) {
    console.error('Store warm-up failed (health endpoint still available):', err);
  }

  return server;
}

start().catch((err) => {
  console.error('Failed to start cloud server:', err);
  process.exit(1);
});
