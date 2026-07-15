import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { optimizeImageBuffer } from './imageProcess.js';
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
  patchStopGlobally,
  listAllStopsFromRoutes,
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
  getBusDisplaySettingsCatalog,
  setBusDisplaySettingsCatalog,
  pickDisplaySettingsPatch,
  countPendingCommands,
  getBusProfile,
  setBusProfilePlate,
  upsertBusProfile,
  pairDriver,
  unlinkDriver,
  unlinkDriverByBusId,
  disconnectAllPhonesForBus,
  getDriverSession,
  verifyLinkedDriverForBus,
  deleteBus,
  deleteDriverRecord,
  updateDriverLocation,
  getLocationHistory,
  addBusAssignedRoute,
  removeBusAssignedRoute,
  getBusAssignedRouteIds,
  listBusIdsWithAssignedRoute,
  hasPendingCommandType,
  getRouteCatalogRevision,
  recordAdPlays,
  getCampaignPlaysSummary,
  getAdPlaysRaw,
  getPricingSettings,
  setPricingSettings,
  getHouseAds,
  setHouseAds,
  getStopVoiceAdsCatalog,
  setStopVoiceAdsCatalog,
  collectAllReferencedMediaPaths,
  describeMediaReferences,
  removeMediaReferenceEverywhere,
} from './store.js';
import { computeAdSpend, isAdExhausted } from './pricing.js';
import {
  CLOUD_VERSION,
  buildPcLatestYml,
  getFleetVersions,
  getReleaseConfig,
  setDriverRelease,
  setHotpatchRelease,
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
  findCampaignByAdId,
  adFormatInCampaign,
  rerunCampaign,
  getCampaignReport,
} from './campaigns.js';
import { getBusAdAnalytics, getFleetAdAnalytics } from './adAnalytics.js';
import {
  enrollDevice,
  getEnrollmentStatus,
  acknowledgeEnrollment,
  claimBusByCode,
  listPendingEnrollments,
  revokeBusDevice,
  verifyBusDeviceToken,
  findBusIdByDeviceToken,
  withMediaFiles,
} from './fleet.js';
import { enrollLimiter, pairLimiter, authLimiter, locationLimiter, driveLimiter } from './middleware/rateLimit.js';
import { requestLogger, writeAudit } from './logger.js';
import { verifyR2Config, uploadMediaBuffer, getPublicMediaUrl, deleteMediaFile } from './mediaStorage.js';
import { collectAdMediaPathsFromLists, collectRemovedAdMediaPaths } from './adsCatalog.js';
import { usePostgres, getPool } from './db/pool.js';
import { getPublicConfig, getPublicUrl, getCloudUrls } from './config.js';
import { verifyDriverControlForBus } from './driverOtp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
const ADMIN_KEY = process.env.ADKERALA_ADMIN_KEY ?? 'change-me-in-production';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

/**
 * Delete each of `candidatePaths` from disk/R2, but only the ones nothing in the system still
 * references (see collectAllReferencedMediaPaths in store.js). Call this after any operation
 * that *might* have dropped the last reference to a file — removing an ad from a campaign,
 * house ads, one bus's catalog, or a stop voice-ad. The same file is very often shared (a
 * campaign push copies its ads' mediaFile onto every targeted bus), so a candidate that's still
 * referenced anywhere else is silently skipped rather than deleted.
 */
async function purgeUnreferencedMedia(candidatePaths = []) {
  const unique = [...new Set(candidatePaths.filter(Boolean))];
  if (!unique.length) return;
  const inUse = await collectAllReferencedMediaPaths();
  for (const relPath of unique) {
    if (inUse.has(relPath)) continue;
    try {
      await deleteMediaFile(relPath, MEDIA_DIR);
    } catch (err) {
      console.warn('Media purge failed:', relPath, err.message);
    }
  }
}

if (ADMIN_KEY === 'change-me-in-production' && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: Set ADKERALA_ADMIN_KEY in production!');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '140mb' }));
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

/**
 * Some endpoints (e.g. GET .../routes) are called both by the admin/owner dashboard
 * (session or admin key) and by the bus device itself (bus key/token) — route to whichever
 * credential is actually present so neither caller shadows the other. IMPORTANT: only ever
 * register ONE Express route per method+path when using this — a second `app.get()` for the
 * same path is dead code, since Express stops at the first matching layer that sends a
 * response and never falls through to a later duplicate registration.
 */
function authBusOrFleet(req, res, next) {
  if (req.headers['x-bus-token'] || req.headers['x-bus-key']) {
    authBus(req, res, next);
    return;
  }
  authFleet(req, res, next);
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
          res.status(401).json({ ok: false, error: 'Invalid bus token', revoked: true });
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

app.post('/api/fleet/enroll/:installId/ack', enrollLimiter, async (req, res) => {
  const result = await acknowledgeEnrollment(req.params.installId);
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

app.post('/api/buses/:busId/verify-driver-control', authBus, async (req, res) => {
  const busId = req.busId ?? req.params.busId;
  const { pairingCode } = req.body ?? {};
  const result = await verifyDriverControlForBus(busId, pairingCode);
  if (!result.ok) {
    res.status(403).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/buses/:busId/verify-linked-driver', authBus, async (req, res) => {
  const busId = req.busId ?? req.params.busId;
  const result = await verifyLinkedDriverForBus(busId, req.body?.driverId);
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
  const prev = await getCampaign(req.params.id);
  const result = await updateCampaign(req.params.id, req.user, req.body ?? {});
  if (!result.ok) {
    res.status(result.error === 'Forbidden' ? 403 : 404).json(result);
    return;
  }
  if (prev) {
    const removed = collectRemovedAdMediaPaths(
      prev.ads,
      prev.bannerAds,
      result.campaign.ads,
      result.campaign.bannerAds
    );
    await purgeUnreferencedMedia(removed);
  }
  res.json(result);
});

app.delete('/api/campaigns/:id', authSession, requireAuth, requireRole('admin', 'advertiser'), async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  const result = await deleteCampaign(req.params.id, req.user);
  if (!result.ok) {
    res.status(result.error === 'Forbidden' ? 403 : 404).json(result);
    return;
  }
  if (campaign) {
    await purgeUnreferencedMedia(collectAdMediaPathsFromLists(campaign.ads, campaign.bannerAds));
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

// Rerun a completed campaign with fresh budgets — clones its ads under new ids into a brand
// new campaign; the original is never touched, so its Completed-section report stays intact.
app.post('/api/campaigns/:id/rerun', authSession, requireAuth, requireRole('admin', 'advertiser'), async (req, res) => {
  const result = await rerunCampaign(req.params.id, req.user, req.body ?? {});
  if (!result.ok) {
    res.status(result.error === 'Forbidden' ? 403 : 404).json(result);
    return;
  }
  res.json(result);
});

// Proof-of-play summary for a campaign — foundation for monetization; no pricing/billing here,
// just what actually played, where, and for how long (see server/cloudSync.js + BusStoreProvider.jsx
// endAd() for how these events get recorded and uploaded).
app.get('/api/campaigns/:id/plays', authSession, requireAuth, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'Campaign not found' });
    return;
  }
  if (req.user.role === 'advertiser' && campaign.advertiserId !== req.user.id) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  if (!['admin', 'advertiser'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const summary = await getCampaignPlaysSummary(req.params.id);
  res.json({ ok: true, campaignId: req.params.id, ...summary });
});

// Per-ad × per-bus × per-route play breakdown — the Completed-campaign report. Same auth as
// .../plays above; fetched on-demand (not eagerly for every campaign) since it's heavier.
app.get('/api/campaigns/:id/report', authSession, requireAuth, async (req, res) => {
  const campaign = await getCampaign(req.params.id);
  if (!campaign) {
    res.status(404).json({ ok: false, error: 'Campaign not found' });
    return;
  }
  if (req.user.role === 'advertiser' && campaign.advertiserId !== req.user.id) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  if (!['admin', 'advertiser'].includes(req.user.role)) {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const report = await getCampaignReport(req.params.id);
  res.json({ ok: true, ...report });
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
    en: stop.en || catalog.en || '',
    ml: catalog.ml || stop.ml || '',
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

const routeSyncDebounce = new Map();
const ROUTE_SYNC_DEBOUNCE_MS = 5000;

async function buildAssignedRoutesPayload(busId) {
  const rawIds = await getBusAssignedRouteIds(busId);
  const routes = [];
  const validIds = [];
  for (const id of rawIds) {
    const route = await getRouteById(id);
    if (!route) continue;
    validIds.push(id);
    const enriched = await enrichRouteForClient(route);
    routes.push({
      id: enriched.id,
      name: enriched.name,
      startStop: enriched.startStop,
      endStop: enriched.endStop,
      stops: enriched.stops ?? [],
      sharedFromCloud: true,
      cloudRouteId: enriched.id,
    });
  }
  if (validIds.length !== rawIds.length) {
    await upsertBusProfile(busId, { assignedRouteIds: validIds });
  }
  return { assignedIds: validIds, routes };
}

async function pushAssignedRoutesToBuses(targetBusIds = []) {
  const commandIds = [];
  for (const busId of [...new Set((targetBusIds ?? []).filter(Boolean))]) {
    const cmd = await enqueueAssignedRouteSync(busId);
    if (cmd?.id) commandIds.push({ busId, commandId: cmd.id });
  }
  return commandIds;
}

/** Authoritative sync — assigned routes only, drops stale copies on the bus. */
async function enqueueAssignedRouteSync(busId) {
  if (!busId) return null;
  const { assignedIds, routes } = await buildAssignedRoutesPayload(busId);
  const store = await loadStore();
  const savedAt = Date.now();
  routeSyncDebounce.set(busId, Date.now());
  return enqueueCommand(busId, 'SYNC_ASSIGNED_ROUTES', {
    routes,
    assignedRouteIds: assignedIds,
    stopCatalog: store.stopCatalog ?? [],
    removeLocalOrphans: true,
    savedAt,
  });
}

async function maybeEnqueueAssignedRouteSync(busId, busState = {}) {
  if (!busId) return null;
  const { assignedIds, routes } = await buildAssignedRoutesPayload(busId);

  const busAssigned = busState?.busProfile?.assignedRouteIds;
  if (!Array.isArray(busAssigned)) {
    return enqueueAssignedRouteSync(busId);
  }

  const busSet = new Set(busAssigned);
  const cloudSet = new Set(assignedIds);
  const idsMismatch =
    busAssigned.length !== assignedIds.length ||
    busAssigned.some((id) => !cloudSet.has(id)) ||
    assignedIds.some((id) => !busSet.has(id));
  if (idsMismatch) {
    return enqueueAssignedRouteSync(busId);
  }

  const busRoutes = busState?.routes ?? [];
  const busIds = busRoutes.map((r) => r.id);
  const localOrphans = busRoutes.filter((r) => !r.sharedFromCloud && !r.cloudRouteId);
  const assignedSet = new Set(assignedIds);
  const extraOnBus = busIds.filter((id) => !assignedSet.has(id));
  const missingOnBus = assignedIds.filter((id) => !busIds.includes(id));

  if (!localOrphans.length && !extraOnBus.length && !missingOnBus.length) return null;

  const last = routeSyncDebounce.get(busId) ?? 0;
  if (Date.now() - last < ROUTE_SYNC_DEBOUNCE_MS) return null;
  if (await hasPendingCommandType(busId, 'SYNC_ASSIGNED_ROUTES')) return null;

  return enqueueAssignedRouteSync(busId);
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
    // Advertisers need enough to identify a bus when picking campaign targets (plate/display
    // name), but nothing sensitive (owner, pairing code, linked driver).
    res.json({
      ok: true,
      buses: buses.map((b) => ({
        busId: b.busId,
        profile: {
          displayName: b.profile?.displayName ?? '',
          plate: b.profile?.plate ?? '',
          plateDisplay: b.profile?.plateDisplay ?? '',
        },
      })),
    });
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

/** Compact now-playing preview for every bus in the fleet (Live Wall grid). */
function buildLiveWallPreview(row) {
  const telemetry = row?.telemetry ?? {};
  const state = row?.state ?? {};
  const displayView = state.displayView ?? telemetry.displayView ?? 'route';
  const routeName = telemetry.routeName ?? state.routeName ?? null;
  const currentStopEn = telemetry.currentStopEn ?? null;
  const nextStopEn = telemetry.nextStopEn ?? null;

  let ad = null;
  if (displayView === 'ad') {
    const idx = Number.isFinite(Number(state.currentAdIndex)) ? Number(state.currentAdIndex) : 0;
    const raw = state.ads?.[idx] ?? null;
    if (raw) {
      ad = {
        id: raw.id ?? null,
        name: raw.name ?? null,
        type: raw.type ?? null,
        mediaFile: raw.mediaFile ?? null,
        durationSec: raw.durationSec ?? null,
        isHouseAd: Boolean(raw.isHouseAd),
        campaignId: raw.campaignId ?? null,
      };
    }
  }

  return {
    displayView,
    routeName,
    currentStopEn,
    nextStopEn,
    tripStarted: Boolean(state.tripStarted ?? telemetry.tripStarted ?? telemetry.tripDeparted),
    tripEnded: Boolean(state.tripEnded ?? telemetry.tripEnded),
    ad,
  };
}

app.get('/api/buses/live-wall', authSession, requireAuth, requireRole('admin'), async (_req, res) => {
  const buses = await listBuses({});
  res.json({
    ok: true,
    buses: buses.map((row) => {
      const online = Boolean(row.updatedAt) && Date.now() - row.updatedAt < ONLINE_MS;
      return {
        busId: row.busId,
        profile: row.profile ?? null,
        online,
        updatedAt: row.updatedAt ?? 0,
        preview: buildLiveWallPreview(row),
      };
    }),
  });
});

app.get('/api/analytics/ads-fleet', authSession, requireAuth, requireRole('admin'), async (req, res) => {
  const summaryOnly = req.query.summaryOnly === '1' || req.query.summaryOnly === 'true';
  const report = await getFleetAdAnalytics({ summaryOnly });
  res.json({ ok: true, ...report });
});

app.get('/api/buses/:busId/ad-analytics', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const analytics = await getBusAdAnalytics(req.params.busId);
  res.json({ ok: true, ...analytics });
});

// NOTE: this single route serves BOTH callers — the admin/owner dashboard (fleet session or
// admin key) AND the bus device itself (bus key/token, for its own pull-reconcile sync). They
// used to be two separate `app.get()` registrations for the exact same method+path; the second
// (bus-facing) one was permanently unreachable because Express stops at the first layer that
// sends a response and never tries a later duplicate route — so every bus-side call here was
// silently returning 401 and the bus never actually reconciled its routes/stops against the
// cloud. See authBusOrFleet's doc comment.
app.get('/api/buses/:busId/routes', authBusOrFleet, async (req, res) => {
  const busId = req.params.busId;

  if (req.user) {
    // Admin/owner dashboard view — includes live trip/telemetry for the fleet map.
    if (!(await assertBusAccess(req, res, busId))) return;
    const row = await getBus(busId);
    const { assignedIds, routes } = await buildAssignedRoutesPayload(busId);
    const activeRouteId =
      row?.state?.activeRouteId ?? row?.telemetry?.activeRouteId ?? null;
    const activeRoute = routes.find((r) => r.id === activeRouteId) ?? null;
    res.json({
      ok: true,
      busId,
      assignedRouteIds: assignedIds,
      routes,
      activeRouteId,
      activeRoute,
      trip: {
        tripStarted: Boolean(row?.state?.tripStarted ?? row?.telemetry?.tripStarted),
        tripEnded: Boolean(row?.state?.tripEnded ?? row?.telemetry?.tripEnded),
        routeDirection: row?.state?.routeDirection ?? row?.telemetry?.routeDirection ?? 'forward',
        currentStopIndex: row?.state?.currentStopIndex ?? row?.telemetry?.currentStopIndex ?? 0,
      },
    });
    return;
  }

  // Bus device pull sync (spec: full reconciliation, not deltas) — assigned routes + stop
  // catalog + a revision stamp the bus compares against its own routesSavedAt.
  const { assignedIds, routes } = await buildAssignedRoutesPayload(busId);
  const store = await loadStore();
  res.json({
    ok: true,
    routes,
    assignedRouteIds: assignedIds,
    stopCatalog: store.stopCatalog ?? [],
    routesSavedAt: await getRouteCatalogRevision(),
  });
});

// Same `/driver?control=<lan-url>&code=<4digits>` format the passenger-display QR already
// encodes (see cloud/shared/hub/persist.js readHubControlFromLocation / lan.js
// parsePairCodeFromSearch) — this just lets admin regenerate that link/QR for a conductor who
// needs access after the driver has already paired and the QR is no longer shown. Same trust
// model as the QR itself: whoever gets this link gets full control, same as the driver.
function buildDriverConnectUrl(telemetry) {
  const lanIp = telemetry?.lanIp;
  const controlPort = telemetry?.controlPort;
  const pairingCode = telemetry?.pairingCode;
  if (!lanIp || !controlPort || !pairingCode) return null;
  const controlUrl = `http://${lanIp}:${controlPort}`;
  return `${getPublicUrl()}/driver?control=${encodeURIComponent(controlUrl)}&code=${encodeURIComponent(pairingCode)}`;
}

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
    driverConnectUrl: online ? buildDriverConnectUrl(row.telemetry) : null,
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
  const busId = req.params.busId;
  const { plate, plateDisplay, pairingCode, displayName } = req.body ?? {};

  let normalizedCode = null;
  if (pairingCode != null) {
    normalizedCode = String(pairingCode).replace(/\D/g, '').slice(0, 4);
    if (normalizedCode.length !== 4) {
      res.status(400).json({ ok: false, error: 'Pairing code must be exactly 4 digits' });
      return;
    }
  }

  let profile;
  if (plate != null) {
    profile = await setBusProfilePlate(busId, plate);
  }
  const patch = {};
  if (displayName != null) patch.displayName = String(displayName).trim().slice(0, 80);
  if (plateDisplay != null && plate == null) patch.plateDisplay = String(plateDisplay).trim();
  if (normalizedCode != null) patch.pairingCode = normalizedCode;
  if (Object.keys(patch).length) {
    profile = await upsertBusProfile(busId, patch);
  }
  if (!profile) profile = await getBusProfile(busId);

  await enqueueCommand(busId, 'MERGE_STATE', {
    rotatePairingCode: normalizedCode != null,
    busProfile: {
      plate: profile.plate,
      plateDisplay: profile.plateDisplay,
      displayName: profile.displayName ?? '',
      ...(normalizedCode != null ? { pairingCode: normalizedCode } : {}),
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

/** Admin cleanup of a stale driver record (e.g. one not linked to any current bus). */
app.delete('/api/drivers/:driverId', authAdminOnly, async (req, res) => {
  const result = await deleteDriverRecord(req.params.driverId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  await writeAudit('fleet.driver.delete', req.user.id, { driverId: req.params.driverId });
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

app.post('/api/driver/drive', driveLimiter, async (req, res) => {
  const { driverId, action, ...extra } = req.body ?? {};
  const result = await queueDriverDriveAction(String(driverId ?? '').trim(), action, extra);
  if (!result.ok) {
    const status =
      result.error === 'Driver not linked to a bus'
        ? 403
        : result.error === 'Bus is offline. Start the bus PC app first.'
          ? 503
          : 400;
    res.status(status).json(result);
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

app.post('/api/buses/:busId/disconnect-all-phones', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const result = await disconnectAllPhonesForBus(req.params.busId);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/buses/:busId/telemetry', authBus, async (req, res) => {
  const busId = req.params.busId;
  const { telemetry, state, displaySnapshot } = req.body ?? {};
  const prevRow = await getBus(busId);
  const wasOffline = !prevRow?.updatedAt || Date.now() - prevRow.updatedAt > ONLINE_MS;
  await upsertBusTelemetry(busId, { telemetry, state, displaySnapshot });
  await maybeEnqueueAssignedRouteSync(busId, state ?? {});
  const profile = await getBusProfile(busId);
  const commands = await pullPendingCommands(busId);
  res.json({
    ok: true,
    devicesDisconnectAt: profile?.devicesDisconnectAt ?? null,
    pairingCode: profile?.pairingCode ?? null,
    pendingCommands: commands.length,
    commands,
    wasOffline,
  });
});

// Bus-reported ad play events — best-effort proof-of-play for campaign reporting. The bus
// queues these locally and uploads in small batches (see server/cloudSync.js); idempotent on
// play.id so a retried upload after a partial failure never double-counts.
app.post('/api/buses/:busId/ad-plays', authBus, async (req, res) => {
  const plays = Array.isArray(req.body?.plays) ? req.body.plays : [];
  const result = await recordAdPlays(req.params.busId, plays);
  res.json({ ok: true, ...result });
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

// Read-only dashboard view of what's *actually* playing on a bus — mirrors the device-facing
// GET .../ads below (house ads merged in, exhaustion stamped), but deliberately kept separate
// from the editable .../ads/catalog route above: that one's payload gets PUT back verbatim on
// save, so mixing house ads into it would persist stray copies into the bus's own catalog.
app.get('/api/buses/:busId/ads/live', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const row = await getBus(req.params.busId);
  await syncBusAdsCatalogFromTelemetry(req.params.busId, row?.state ?? {});
  const catalog = await getBusAdsCatalog(req.params.busId);
  const houseAds = await getHouseAds();
  const ads = [...(await stampExhaustion(catalog.ads)), ...houseAds.ads];
  const bannerAds = [...catalog.bannerAds, ...houseAds.bannerAds];
  res.json({ ok: true, ads, bannerAds, adsSavedAt: catalog.adsSavedAt });
});

// Stamps `exhausted` onto each budgeted ad (spend computed fresh from reported plays against
// current pricing settings — see cloud/pricing.js), so the bus's own rotation
// (src/lib/adPlayback.js nextPlayableAdIndex) can skip exhausted paid ads and fall back to
// house ads without needing any cloud round-trip of its own. Budget/exhaustion is a fullscreen-
// only concept (banner ads aren't instrumented by endAd()'s play tracking), so this only
// applies to the fullscreen list — banner house ads are appended separately, unconditionally.
async function stampExhaustion(list = [], format = 'fullscreen') {
  const pricingSettings = await getPricingSettings();
  return Promise.all(
    list.map(async (ad) => {
      if (!Number.isFinite(Number(ad.amount)) || Number(ad.amount) <= 0) return ad;
      const plays = await getAdPlaysRaw(ad.id);
      const { spend } = computeAdSpend(plays, format, pricingSettings);
      return { ...ad, exhausted: isAdExhausted(ad.amount, spend) };
    })
  );
}

// Bus device pull sync for ads/banner ads (full reconciliation, mirrors GET .../routes above).
// The UPDATE_ADS command gives near-instant updates while the bus is online, but this periodic
// pull is what guarantees the bus eventually converges to exactly what the cloud has — including
// ads deleted server-side — even if a command was ever missed, expired, or never queued for this
// specific bus.
app.get('/api/buses/:busId/ads', authBus, async (req, res) => {
  const busId = req.params.busId;
  const row = await getBus(busId);
  await syncBusAdsCatalogFromTelemetry(busId, row?.state ?? {});
  const catalog = await getBusAdsCatalog(busId);
  const houseAds = await getHouseAds();
  const ads = [...(await stampExhaustion(catalog.ads)), ...houseAds.ads];
  const bannerAds = [...catalog.bannerAds, ...houseAds.bannerAds];
  res.json({
    ok: true,
    ads,
    bannerAds,
    adsSavedAt: catalog.adsSavedAt,
    mediaFiles: collectAdMediaPathsFromLists(ads, bannerAds),
  });
});

// Platform-wide pricing — not a per-bus concept, so no busId in the path or ownership check
// (bus_owner accounts don't set pricing; only admin does).
app.get('/api/pricing-settings', authAdminOnly, async (_req, res) => {
  const settings = await getPricingSettings();
  res.json({ ok: true, ...settings });
});

app.put('/api/pricing-settings', authAdminOnly, async (req, res) => {
  const settings = await setPricingSettings(req.body ?? {});
  res.json({ ok: true, ...settings });
});

// House/free ads — admin-managed, pushed to every bus regardless of campaign targeting (see
// the ads-serving route above). Covers both fullscreen and banner ads; reuses the same
// ad-object shape/upload flow as campaign ads, the only difference is isHouseAd stamped in,
// no amount/campaignId/targeting.
app.get('/api/house-ads', authAdminOnly, async (_req, res) => {
  const houseAds = await getHouseAds();
  res.json({ ok: true, ...houseAds });
});

app.put('/api/house-ads', authAdminOnly, async (req, res) => {
  const prev = await getHouseAds();
  const houseAds = await setHouseAds({
    ads: Array.isArray(req.body?.ads) ? req.body.ads : [],
    bannerAds: Array.isArray(req.body?.bannerAds) ? req.body.bannerAds : [],
  });
  const removed = collectRemovedAdMediaPaths(prev.ads, prev.bannerAds, houseAds.ads, houseAds.bannerAds);
  await purgeUnreferencedMedia(removed);
  res.json({ ok: true, ...houseAds });
});

// Per-ad spend vs budget — admin visibility into where a campaign's money is actually going,
// beyond the aggregate per-campaign totals in GET /api/campaigns/:id/plays. Ownership is
// checked via the owning campaign (an advertiser must not see another advertiser's ad spend
// just by guessing an ad id) — house ads have no owning campaign and are admin-only.
app.get('/api/ads/:adId/spend', authSession, requireAuth, async (req, res) => {
  const campaign = await findCampaignByAdId(req.params.adId);
  if (req.user.role === 'advertiser') {
    if (!campaign || campaign.advertiserId !== req.user.id) {
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }
  } else if (req.user.role !== 'admin') {
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return;
  }
  const pricingSettings = await getPricingSettings();
  const plays = await getAdPlaysRaw(req.params.adId);
  const format = await adFormatInCampaign(campaign, req.params.adId);
  const { peakSec, offPeakSec, spend } = computeAdSpend(plays, format, pricingSettings);
  res.json({ ok: true, adId: req.params.adId, format, plays: plays.length, peakSec, offPeakSec, spend });
});

app.get('/api/buses/:busId/display-settings/catalog', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const catalog = await getBusDisplaySettingsCatalog(req.params.busId);
  res.json({ ok: true, ...catalog });
});

app.get('/api/buses/:busId/display-settings', authBus, async (req, res) => {
  const catalog = await getBusDisplaySettingsCatalog(req.params.busId);
  res.json({
    ok: true,
    displaySettings: catalog.displaySettings,
    adSettings: catalog.adSettings,
    bannerAdSettings: catalog.bannerAdSettings,
    announcementSettings: catalog.announcementSettings,
    driveSettings: catalog.driveSettings,
    settingsSavedAt: catalog.settingsSavedAt ?? 0,
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
  await purgeUnreferencedMedia(removedMedia);
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
  await addBusAssignedRoute(req.params.busId, route.id);
  const assignedRouteIds = await getBusAssignedRouteIds(req.params.busId);
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
    assignedRouteIds,
    activeRouteId: route.id,
    savedAt: Date.now(),
  });
  const audioCommandIds = await queueAudioBundleForBus(req.params.busId, { routeId: route.id });
  res.json({ ok: true, commandId: cmd.id, audioCommandIds, route, assignedRouteIds });
});

/** Remove a route from a bus fleet assignment (does not delete from catalog). */
app.delete('/api/buses/:busId/assigned-routes/:routeId', authFleet, async (req, res) => {
  if (!(await assertBusAccess(req, res, req.params.busId))) return;
  const busId = req.params.busId;
  const routeId = req.params.routeId;
  await removeBusAssignedRoute(busId, routeId);
  const cmd = await enqueueAssignedRouteSync(busId);
  const assignedRouteIds = (await buildAssignedRoutesPayload(busId)).assignedIds;
  res.json({ ok: true, commandId: cmd?.id ?? null, assignedRouteIds, removed: routeId });
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
  await addBusAssignedRoute(req.params.busId, route.id);
  const assignedRouteIds = await getBusAssignedRouteIds(req.params.busId);
  const cmd = await enqueueCommand(req.params.busId, 'UPSERT_ROUTE', {
    route: {
      ...route,
      sharedFromCloud: true,
      cloudRouteId: route.id,
    },
    assignedRouteIds,
    savedAt: Date.now(),
  });
  const audioCommandIds = await queueAudioBundleForBus(req.params.busId, { routeId: route.id });
  res.json({ ok: true, commandId: cmd.id, audioCommandIds, route, assignedRouteIds });
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
  const settingsPatch = commandType === 'MERGE_STATE' ? pickDisplaySettingsPatch(mergedPayload) : null;
  const settingsSavedAt = settingsPatch ? Date.now() : null;
  if (settingsPatch) {
    mergedPayload.settingsSavedAt = settingsSavedAt;
  }
  const commandIds = [];
  const onlineNow = [];
  for (const busId of busIds) {
    if (settingsPatch) {
      await setBusDisplaySettingsCatalog(busId, settingsPatch, {
        settingsSavedAt,
        source: 'dashboard',
      });
    }
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
    const row = await getBus(busId);
    if (row?.updatedAt && Date.now() - row.updatedAt < ONLINE_MS) {
      onlineNow.push(busId);
    }
  }
  res.json({ ok: true, queuedFor: busIds, commandIds, onlineNow });
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
  await purgeUnreferencedMedia(payload.removedFiles ?? []);
  res.json({ ok: true, ...payload });
});

/** Per-stop voice clips keyed by English stop name (shared catalog). */
app.get('/api/stops/audio', authBus, async (_req, res) => {
  const payload = await getStopAudioCatalog();
  res.json({ ok: true, ...payload });
});

app.get('/api/stops/audio/catalog', authCatalog, async (_req, res) => {
  const payload = await getStopAudioCatalog();
  res.json({ ok: true, ...payload });
});

app.put('/api/stops/audio', authCatalog, async (req, res) => {
  const { stopAudio, mediaFiles } = req.body ?? {};
  const payload = await mergeStopAudioCatalog(stopAudio ?? {}, mediaFiles);
  await purgeUnreferencedMedia(payload.removedFiles ?? []);
  res.json({ ok: true, ...payload });
});

// Per-stop voice ads — deliberately a separate catalog/endpoint from /api/stops/audio above,
// not extra fields on it (see getStopVoiceAdsCatalog's comment in cloud/store.js for why).
app.get('/api/stops/voice-ads', authBus, async (_req, res) => {
  const payload = await getStopVoiceAdsCatalog();
  res.json({ ok: true, ...payload });
});

app.get('/api/stops/voice-ads/catalog', authCatalog, async (_req, res) => {
  const payload = await getStopVoiceAdsCatalog();
  res.json({ ok: true, ...payload });
});

app.put('/api/stops/voice-ads', authCatalog, async (req, res) => {
  const prev = await getStopVoiceAdsCatalog();
  const payload = await setStopVoiceAdsCatalog(req.body?.stopVoiceAds ?? {});
  const removed = prev.mediaFiles.filter((p) => !payload.mediaFiles.includes(p));
  await purgeUnreferencedMedia(removed);
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
  const commandIds = await pushAssignedRoutesToBuses(targetBusIds);
  res.json({ ok: true, route: enriched, pushedTo: targetBusIds, commandIds });
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
    const commandIds = await pushAssignedRoutesToBuses(targetBusIds);
    if (targetBusIds.length) {
      for (const busId of targetBusIds) {
        await queueAudioBundleForBus(busId, { routeId: enriched.id });
      }
    }
    res.json({ ok: true, route: enriched, pushedTo: targetBusIds, commandIds });
  } catch (err) {
    console.error('PUT /api/routes failed:', err);
    res.status(500).json({ ok: false, error: err.message ?? 'Could not save route' });
  }
});

app.delete('/api/routes/:routeId', authCatalog, async (req, res) => {
  const routeId = req.params.routeId;
  const ok = await deleteRouteFromCatalog(routeId);
  if (!ok) {
    res.status(404).json({ ok: false, error: 'Route not found' });
    return;
  }
  const targetBusIds = req.body?.targetBusIds ?? [];
  const assignedBusIds = await listBusIdsWithAssignedRoute(routeId);
  const busIds = [...new Set([...targetBusIds, ...assignedBusIds])];
  for (const busId of busIds) {
    await removeBusAssignedRoute(busId, routeId);
    await enqueueCommand(busId, 'DELETE_ROUTE', {
      routeId,
      savedAt: Date.now(),
    });
    await enqueueAssignedRouteSync(busId);
  }
  res.json({ ok: true, deleted: routeId, queuedFor: busIds });
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

app.get('/api/stops', authCatalog, async (req, res) => {
  await ensureStopCatalogFromRoutes();
  const view = String(req.query.view ?? '');
  if (view === 'all') {
    const missing = String(req.query.missing ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const stops = await listAllStopsFromRoutes({
      query: String(req.query.q ?? ''),
      missing,
    });
    res.json({ ok: true, stops, view: 'all' });
    return;
  }
  const store = await loadStore();
  res.json({ ok: true, stops: store.stopCatalog ?? [] });
});

app.patch('/api/stops/:stopEn', authCatalog, async (req, res) => {
  const { targetBusIds = [], ...body } = req.body ?? {};
  try {
    const result = await patchStopGlobally(req.params.stopEn, body);
    if (!result) {
      res.status(404).json({ ok: false, error: 'Stop not found' });
      return;
    }
    invalidateContentGapsCache();

    const stopKey = String(req.params.stopEn).trim();
    const commandIds = await pushAssignedRoutesToBuses(targetBusIds);

    res.json({
      ok: true,
      stop: result.stop,
      routesUpdated: result.routesUpdated,
      affectedRouteIds: result.affectedRouteIds,
      pushedTo: targetBusIds,
      commandIds,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message ?? 'Invalid stop data' });
  }
});

app.post('/api/stops', authCatalog, async (req, res) => {
  const stop = await upsertStopCatalog(req.body ?? {});
  if (!stop) {
    res.status(400).json({ ok: false, error: 'Stop name required' });
    return;
  }
  invalidateContentGapsCache();
  res.json({ ok: true, stop });
});

let contentGapsCache = { at: 0, gaps: [] };
const CONTENT_GAPS_TTL_MS = 5 * 60 * 1000;

function invalidateContentGapsCache() {
  contentGapsCache = { at: 0, gaps: [] };
}

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
  try {
    const route = await patchStopInCatalog(req.params.routeId, req.params.stopEn, stopPatch);
    if (!route) {
      res.status(404).json({ ok: false, error: 'Route or stop not found' });
      return;
    }
    invalidateContentGapsCache();

    const commandIds = await pushAssignedRoutesToBuses(targetBusIds);

    res.json({ ok: true, route, pushedTo: targetBusIds, commandIds });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message ?? 'Invalid stop data' });
  }
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
  const maxBytes =
    category === 'ads' || category === 'banners' ? 100 * 1024 * 1024 : 12 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    res.status(400).json({
      ok: false,
      error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Max ${maxBytes / 1024 / 1024} MB for ${category}.`,
    });
    return;
  }
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 120);
  const relPath = `${category}/${Date.now()}-${safeName}`;
  const fullPath = path.join(MEDIA_DIR, relPath);
  const optimized = await optimizeImageBuffer(buffer, filename);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, optimized);
  await uploadMediaBuffer(relPath, optimized, contentType);

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
  // Deliberately still allowed even if referencedBy is non-empty (the media browser shows that
  // warning to the admin before they confirm) — this is the deliberate manual-cleanup override
  // for stale/broken references, not the automatic reference-checked purge path. Clearing the
  // reference first (same setters a normal edit uses) means every bus's own periodic sync sees
  // the file drop out of its next catalog/audio fetch and deletes its local copy itself — no
  // dangling mediaFile left pointing at a file that no longer exists.
  const referencedBy = (await describeMediaReferences()).get(relPath) ?? [];
  if (referencedBy.length) {
    await removeMediaReferenceEverywhere(relPath);
  }
  const result = await deleteMediaFile(relPath, MEDIA_DIR);
  if (!result.ok) {
    res.status(400).json({ ok: false, error: result.error ?? 'Delete failed' });
    return;
  }
  res.json({ ok: true, deleted: relPath, wasReferencedBy: referencedBy, ...result });
});

const MEDIA_BROWSE_CATEGORIES = ['ads', 'banners', 'stops', 'announcements'];

/** Admin-only listing of every file on the media volume, flagging which ones are still
 * referenced (by a campaign, house ad, bus catalog, stop audio, or phrase) vs orphaned. Backs
 * the Media Browser page — the manual counterpart to the automatic purge that already runs on
 * campaign/house-ad/catalog edits (see purgeUnreferencedMedia above). */
app.get('/api/media/browse', authSession, requireAuth, requireRole('admin'), async (req, res) => {
  const refs = await describeMediaReferences();
  const categories = {};
  const summary = { totalFiles: 0, totalBytes: 0, orphanedFiles: 0, orphanedBytes: 0 };

  for (const category of MEDIA_BROWSE_CATEGORIES) {
    const dir = path.join(MEDIA_DIR, category);
    let entries = [];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile());
    } catch {
      entries = [];
    }
    const files = [];
    for (const entry of entries) {
      const relPath = `${category}/${entry.name}`;
      const stat = await fs.stat(path.join(dir, entry.name)).catch(() => null);
      const size = stat?.size ?? 0;
      const mtime = stat?.mtimeMs ?? 0;
      const referencedBy = refs.get(relPath) ?? [];
      summary.totalFiles += 1;
      summary.totalBytes += size;
      if (!referencedBy.length) {
        summary.orphanedFiles += 1;
        summary.orphanedBytes += size;
      }
      files.push({ path: relPath, filename: entry.name, size, mtime, referencedBy });
    }
    files.sort((a, b) => b.mtime - a.mtime);
    categories[category] = files;
  }

  res.json({ ok: true, categories, summary });
});

async function serveStoredMediaFile(res, relPath) {
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
  else if (lower.endsWith('.mov')) res.type('video/quicktime');
  else if (lower.endsWith('.m4v')) res.type('video/mp4');
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) res.type('image/jpeg');
  else if (lower.endsWith('.png')) res.type('image/png');
  else if (lower.endsWith('.gif')) res.type('image/gif');
  else if (lower.endsWith('.webp')) res.type('image/webp');
  res.sendFile(fullPath);
}

/** Dashboard preview for ad/banner media (session auth). */
app.get('/api/media/preview/:category/:filename', authFleet, async (req, res) => {
  const category = req.params.category;
  if (!['ads', 'banners'].includes(category)) {
    res.status(403).json({ ok: false, error: 'Preview not allowed for this category' });
    return;
  }
  const relPath = `${category}/${req.params.filename}`;
  await serveStoredMediaFile(res, relPath);
});

/** Bus pulls missing media from cloud when internet is available. */
app.get('/api/media/:category/:filename', authBus, async (req, res) => {
  const relPath = `${req.params.category}/${req.params.filename}`;
  await serveStoredMediaFile(res, relPath);
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

app.put('/api/releases/pc/hotpatch', authAdminOnly, async (req, res) => {
  const { version, downloadUrl, sha256, releaseNotes } = req.body ?? {};
  if (!version || !downloadUrl) {
    res.status(400).json({ ok: false, error: 'version and downloadUrl required' });
    return;
  }
  const hotpatch = await setHotpatchRelease({ version, downloadUrl, sha256, releaseNotes });
  res.json({ ok: true, hotpatch });
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

/** Queue APPLY_UPDATE on buses so they restart and install a downloaded update. */
app.post('/api/releases/push-update', authAdminOnly, async (req, res) => {
  const { targetBusIds, delaySec = 120 } = req.body ?? {};
  const busIds = await resolveTargetBusIds(req, targetBusIds ?? 'all');
  if (!busIds.length) {
    res.status(400).json({ ok: false, error: 'No buses selected' });
    return;
  }
  const commandIds = [];
  for (const busId of busIds) {
    const cmd = await enqueueCommand(busId, 'APPLY_UPDATE', {
      delaySec: Number(delaySec) || 120,
      source: 'admin',
      requestedAt: Date.now(),
    });
    commandIds.push({ busId, commandId: cmd.id });
  }
  res.json({ ok: true, queuedFor: busIds.length, commandIds });
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

// Bus-token authenticated (unlike the plain PC installer feed above, which electron-updater's
// generic provider polls with no bus identity at all) — a hot-patch bundle is executable code
// that will run with full privileges on the bus PC, so it gets the same auth as other
// bus-specific catalog pulls (see /api/stops/audio) rather than being open to anyone.
app.get('/api/releases/pc/hotpatch/latest', authBus, async (_req, res) => {
  const config = await getReleaseConfig();
  res.json({ ok: true, release: config.hotpatch });
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
