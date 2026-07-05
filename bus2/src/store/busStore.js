import { readIdbState, writeIdbState } from '../lib/idbStorage.js';
import { fetchStateFromDb, hydrateStateFromFile, isDbApiAvailable, saveStateToDb } from '../lib/fileStorage.js';
import { resolveTripFields } from './tripMerge.js';
import { mergeBusProfile } from './busProfileMerge.js';

const STORAGE_KEY = 'kerala-bus-state';
const ROUTE_CACHE_KEY = 'kerala-bus-route-cache';
const CHANNEL_NAME = 'kerala-bus-sync';

const defaultState = () => ({
  routes: [],
  activeRouteId: null,
  currentStopIndex: 0,
  tripStarted: false,
  tripEnded: false,
  tripDeparted: false,
  routeDirection: 'forward',
  driveRevision: 0,
  ads: [],
  bannerAds: [],
  adsSavedAt: 0,
  adSettings: {
    enabled: true,
    initialDelaySec: 90,
    intervalSec: 90,
    defaultDurationSec: 12,
    playAudio: true,
  },
  bannerAdSettings: {
    enabled: true,
    defaultDurationSec: 8,
  },
  displaySettings: {
    languageAlternateSec: 4,
    brandTitle: '',
    theme: {
      primaryColor: '#1a5632',
      backgroundColor: '#0b1220',
      fontScale: 1,
      showClock: true,
      showBanner: true,
    },
  },
  announcementSettings: {
    enabled: true,
    autoAnnounceOnForward: true,
    languages: ['ml', 'en'],
    pauseBetweenFragmentsMs: 300,
  },
  /** Drive mode — separate from manual Forward; GPS auto uses gpsAutoDrive.js */
  driveSettings: {
    mode: 'manual',
    autoForward: true,
    minAccuracyM: 60,
    departureHysteresisM: 25,
    cooldownSec: 20,
  },
  audioFragments: {},
  stopAudio: {},
  announcementRequest: null,
  announcementStatus: null,
  displayView: 'route',
  appView: 'control',
  isFullscreen: false,
  navigateRequest: null,
  /** Live GPS from driver phone — synced to bus display + cloud */
  driverLocation: null,
  /** Number plate + pairing code for driver app link */
  busProfile: {
    plate: '',
    plateDisplay: '',
    pairingCode: '',
  },
  /** Active driver session from cloud pair */
  driverLink: null,
  /** Phones connected on LAN (pair code unlock) — display hides QR when > 0 */
  connectedDeviceCount: 0,
  /** Shared stop names + GPS + ml — synced from cloud catalog */
  stopCatalog: [],
  serialSettings: {
    enabled: true,
    portLocked: true,
    baudRate: 115200,
    savedPortInfo: null,
    buttonMappings: {
      forward: '1',
      backward: '2',
      speech: '3',
      idle: '0',
    },
    fullscreenCommand: 'fullscreen',
    exitCommand: 'exit',
    debounceMs: 500,
  },
  /** Live console USB on bus display PC — updated by /display, read on /control */
  serialRuntime: null,
  currentAdIndex: 0,
  nextAdIndex: 0,
  lastAdEndedAt: Date.now(),
  adStartedAt: null,
  /** When passenger display last opened — used for initial ad delay. */
  displayOpenedAt: null,
});

let listeners = new Set();
let channel = null;
/** Set once db/info.txt API is available — browser cache is not used for truth after this. */
let usingDbStorage = false;
let persistenceReady = false;

export function isUsingDbStorage() {
  return usingDbStorage;
}

export function isPersistenceReady() {
  return persistenceReady;
}

export function setPersistenceReady(ready = true) {
  persistenceReady = Boolean(ready);
}

function writeRouteCache(state) {
  if (usingDbStorage) return;
  try {
    const routes = dedupeRoutes(state?.routes ?? []);
    if (!routes.length) {
      localStorage.removeItem(ROUTE_CACHE_KEY);
      return;
    }
    localStorage.setItem(
      ROUTE_CACHE_KEY,
      JSON.stringify({
        routes,
        activeRouteId: state.activeRouteId ?? null,
        savedAt: state.savedAt ?? Date.now(),
      })
    );
  } catch {
    /* ignore quota errors */
  }
}

function applyRouteCacheFallback(state) {
  const routes = dedupeRoutes(state?.routes ?? []);
  if (!routes.length) {
    try {
      localStorage.removeItem(ROUTE_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
  return state;
}

function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e) => {
      if (e.data?.type === 'STATE_UPDATE') {
        listeners.forEach((fn) => {
          try {
            fn((prev) => mergeStoredIntoPrev(prev, e.data.state));
          } catch {
            /* ignore bad sync payload */
          }
        });
      }
    };
  }
  return channel;
}

function coerceRoutesArray(routes) {
  if (Array.isArray(routes)) return routes;
  if (routes && typeof routes === 'object' && routes.id) return [routes];
  return [];
}

function dedupeRoutes(routes) {
  const seen = new Set();
  return coerceRoutesArray(routes)
    .map(normalizeRouteMiddleStops)
    .filter((route) => {
      if (!route?.id || seen.has(route.id)) return false;
      seen.add(route.id);
      return true;
    });
}

function reviveAnnouncementRequest(req) {
  if (!req?.id || !req?.at) return null;
  // Ignore stale requests left in storage from a previous session.
  if (Date.now() - req.at > 30000) return null;
  return req;
}

function coerceStopsArray(stops) {
  return Array.isArray(stops) ? stops : [];
}

function mergeStoredState(parsed) {
  try {
    const defaults = defaultState();
    const safe = parsed && typeof parsed === 'object' ? parsed : {};
    const hydrated = hydrateStateFromFile(safe);
    const routes = dedupeRoutes(hydrated.routes);

    let activeRouteId = hydrated.activeRouteId ?? null;
    if (activeRouteId && !routes.some((r) => r.id === activeRouteId)) {
      activeRouteId = routes[0]?.id ?? null;
    }

    let currentStopIndex = Number.isFinite(hydrated.currentStopIndex)
      ? hydrated.currentStopIndex
      : 0;
    if (routes.length === 0) {
      currentStopIndex = 0;
    } else if (activeRouteId) {
      const route = routes.find((r) => r.id === activeRouteId);
      const stopCount = route ? getAllStops(route).length : 0;
      if (stopCount > 0) {
        currentStopIndex = Math.max(0, Math.min(currentStopIndex, stopCount - 1));
      } else {
        currentStopIndex = 0;
      }
    }

    return {
      ...defaults,
      ...hydrated,
      routes,
      activeRouteId,
      currentStopIndex,
      adSettings: { ...defaults.adSettings, ...(hydrated.adSettings ?? {}) },
      bannerAds: Array.isArray(hydrated.bannerAds) ? hydrated.bannerAds : defaults.bannerAds,
      bannerAdSettings: {
        ...defaults.bannerAdSettings,
        ...(hydrated.bannerAdSettings ?? {}),
      },
      displaySettings: {
        ...defaults.displaySettings,
        ...(hydrated.displaySettings ?? {}),
        theme: {
          ...defaults.displaySettings.theme,
          ...(hydrated.displaySettings?.theme ?? {}),
        },
      },
      serialSettings: {
        ...defaults.serialSettings,
        ...(hydrated.serialSettings ?? {}),
        buttonMappings: {
          ...defaults.serialSettings.buttonMappings,
          ...hydrated.serialSettings?.buttonMappings,
        },
      },
      navigateRequest: null,
      appView: 'control',
      isFullscreen: false,
      displayView: hydrated.displayView ?? 'route',
      announcementSettings: {
        ...defaults.announcementSettings,
        ...(hydrated.announcementSettings ?? {}),
      },
      driveSettings: {
        ...defaults.driveSettings,
        ...(hydrated.driveSettings ?? {}),
      },
      busProfile: {
        ...defaults.busProfile,
        ...(hydrated.busProfile ?? {}),
      },
      driverLink: hydrated.driverLink ?? null,
      audioFragments: hydrated.audioFragments ?? {},
      stopAudio: hydrated.stopAudio ?? {},
      announcementRequest: reviveAnnouncementRequest(hydrated.announcementRequest),
      announcementStatus: null,
      lastAdEndedAt: hydrated.lastAdEndedAt ?? Date.now(),
      adStartedAt: hydrated.adStartedAt ?? null,
      routeDirection: hydrated.routeDirection ?? hydrated.direction ?? 'forward',
      tripDeparted: Boolean(hydrated.tripDeparted),
      tripStarted: Boolean(hydrated.tripStarted),
      tripEnded: Boolean(hydrated.tripEnded),
      nextAdIndex: hydrated.nextAdIndex ?? hydrated.currentAdIndex ?? 0,
      ads: Array.isArray(hydrated.ads) ? hydrated.ads : defaults.ads,
      driverLocation: hydrated.driverLocation ?? null,
      stopCatalog: Array.isArray(hydrated.stopCatalog) ? hydrated.stopCatalog : defaults.stopCatalog,
      serialRuntime: hydrated.serialRuntime ?? null,
    };
  } catch (err) {
    console.warn('AdKerala: could not load saved state, using defaults.', err);
    return defaultState();
  }
}

function mergeRoutesFromSync(prevRoutes, storedRoutes, prevSaved, remoteSaved) {
  const remoteIsNewer = remoteSaved >= prevSaved;
  const stored = dedupeRoutes(storedRoutes ?? []);
  const prev = dedupeRoutes(prevRoutes ?? []);

  // When bus db / cloud push is newer, trust it — do not union with stale browser routes.
  if (remoteIsNewer) return stored;

  return prev.length ? prev : stored;
}

function mergeHydratedAudioMap(existing = {}, incoming = {}) {
  const out = { ...(existing ?? {}) };
  for (const [key, langs] of Object.entries(incoming ?? {})) {
    out[key] = { ...(out[key] ?? {}) };
    for (const [lang, val] of Object.entries(langs ?? {})) {
      if (val && typeof val === 'object' && (val.audioUrl || val.audioFile)) {
        out[key][lang] = { ...(out[key][lang] ?? {}), ...val };
      }
    }
  }
  return out;
}

function mergeStopCatalogs(prev = [], stored = []) {
  const byKey = new Map();
  const add = (entry) => {
    const key = String(entry?.en ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...entry, en: entry.en ?? byKey.get(key)?.en });
  };
  for (const entry of prev ?? []) add(entry);
  for (const entry of stored ?? []) add(entry);
  return [...byKey.values()];
}

function mergeStoredIntoPrev(prev, parsed) {
  try {
    const stored = mergeStoredState(parsed);
    const prevSaved = prev?.savedAt ?? 0;
    const remoteSaved = stored.savedAt ?? 0;
    const remoteIsNewer = remoteSaved >= prevSaved;
    const cloudPushAdvanced = (stored.lastCloudPushAt ?? 0) > (prev?.lastCloudPushAt ?? 0);

    const routes = mergeRoutesFromSync(
      prev?.routes ?? [],
      stored.routes ?? [],
      prevSaved,
      remoteSaved
    );
    const stopAudio = mergeHydratedAudioMap(prev?.stopAudio, stored.stopAudio);
    const audioFragments = mergeHydratedAudioMap(prev?.audioFragments, stored.audioFragments);
    const stopCatalog = mergeStopCatalogs(prev?.stopCatalog, stored.stopCatalog);

    const serverAuthoritative = remoteIsNewer || cloudPushAdvanced;
    const liveBase = serverAuthoritative ? { ...prev, ...stored } : { ...stored, ...prev };
    const remoteAdsNewer = (stored.adsSavedAt ?? 0) >= (prev?.adsSavedAt ?? 0);
    const merged = {
      ...liveBase,
      routes,
      stopAudio,
      audioFragments,
      stopCatalog,
      ads: remoteAdsNewer ? (stored.ads ?? []) : (prev?.ads ?? []),
      bannerAds: remoteAdsNewer ? (stored.bannerAds ?? []) : (prev?.bannerAds ?? []),
      adsSavedAt: remoteAdsNewer ? (stored.adsSavedAt ?? 0) : (prev?.adsSavedAt ?? 0),
      lastCloudPushAt: Math.max(prev?.lastCloudPushAt ?? 0, stored.lastCloudPushAt ?? 0),
    };

    const remoteDriverId = stored.driverLink?.driverId ?? null;
    const prevDriverId = prev?.driverLink?.driverId ?? null;
    if (serverAuthoritative || remoteDriverId !== prevDriverId) {
      merged.driverLink = stored.driverLink ?? null;
    }
    if (cloudPushAdvanced && stored.busProfile && typeof stored.busProfile === 'object') {
      merged.busProfile = mergeBusProfile(merged.busProfile, stored.busProfile);
    } else {
      merged.busProfile = mergeBusProfile(prev?.busProfile, merged.busProfile);
    }

    const prevRuntimeAt = prev?.serialRuntime?.at ?? 0;
    const storedRuntimeAt = stored?.serialRuntime?.at ?? 0;
    if (storedRuntimeAt >= prevRuntimeAt && stored.serialRuntime) {
      merged.serialRuntime = stored.serialRuntime;
    } else if (prev?.serialRuntime) {
      merged.serialRuntime = prev.serialRuntime;
    }

    if (prev?.announcementRequest?.id && !stored.announcementRequest?.id) {
      merged.announcementRequest = prev.announcementRequest;
    }

    resolveTripFields(prev, stored, merged);
    merged._cloudPushAdvanced = cloudPushAdvanced;
    return merged;
  } catch {
    return prev ?? defaultState();
  }
}

function readLocalStorageState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return mergeStoredState(JSON.parse(raw));
    }
  } catch {
    /* ignore corrupt localStorage */
  }
  return null;
}

function pickNewestState(localState, idbParsed) {
  if (!localState && !idbParsed) return defaultState();
  if (!localState) return mergeStoredState(idbParsed);
  if (!idbParsed) return localState;

  const localSavedAt = localState.savedAt ?? 0;
  const idbSavedAt = idbParsed.savedAt ?? 0;
  return idbSavedAt > localSavedAt ? mergeStoredState(idbParsed) : localState;
}

/** Initial React state before db/info.txt loads — never read browser cache here. */
export function loadState() {
  return defaultState();
}

/** Load persisted state: db/info.txt when the API is up, else browser storage fallback. */
export async function loadStateAsync() {
  try {
    if (await isDbApiAvailable()) {
      usingDbStorage = true;
      const fromDb = await fetchStateFromDb();
      return applyRouteCacheFallback(mergeStoredState(fromDb));
    }
  } catch (err) {
    console.warn('AdKerala: could not load db/info.txt', err);
  }

  const localState = readLocalStorageState();
  let idbParsed = null;

  try {
    idbParsed = await readIdbState();
  } catch {
    /* ignore */
  }

  return applyRouteCacheFallback(pickNewestState(localState, idbParsed));
}

function stateForPersistence(state) {
  const { displayOpenedAt, announcementStatus, ...rest } = state;
  return {
    ...rest,
    announcementStatus: null,
    savedAt: state.savedAt ?? Date.now(),
  };
}

function persistToLocalStorage(persisted) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function saveStateLocal(state) {
  const persisted = stateForPersistence(state);
  let localOk = false;
  let localError = null;

  try {
    persistToLocalStorage(persisted);
    localOk = true;
  } catch (err) {
    localError = err;
  }

  writeIdbState(persisted)
    .then(() => {
      if (!localOk) getChannel()?.postMessage({ type: 'STATE_UPDATE', state });
    })
    .catch(() => {});

  if (localOk) {
    getChannel()?.postMessage({ type: 'STATE_UPDATE', state });
    return { ok: true };
  }

  const isQuota =
    localError?.name === 'QuotaExceededError' ||
    localError?.code === 22 ||
    /quota/i.test(String(localError?.message ?? ''));

  return {
    ok: false,
    error: isQuota
      ? 'Storage full — remove some ads or use smaller files. A backup save was attempted.'
      : 'Could not save — file may be too large.',
  };
}

let dbWriteInFlight = false;
let pendingDbWrites = 0;

function notifySaveError(message) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('adkerala-save-error', { detail: { message } }));
}

export function isDbWriteInFlight() {
  return dbWriteInFlight;
}

export function hasPendingDbWrites() {
  return pendingDbWrites > 0;
}

/** Update browser cache + other tabs when db/info.txt changed on the server (no write-back). */
export function syncLocalCacheFromServer(state) {
  writeRouteCache(state);
  const persisted = stateForPersistence(state);
  try {
    persistToLocalStorage(persisted);
  } catch {
    /* quota — still broadcast to open tabs */
  }
  getChannel()?.postMessage({ type: 'STATE_UPDATE', state: persisted });
}

export function saveState(state, { force = false } = {}) {
  writeRouteCache(state);

  const persisted = stateForPersistence(state);

  // Same-machine tabs: instant UI sync only (not persisted truth).
  getChannel()?.postMessage({ type: 'STATE_UPDATE', state: persisted });

  if (!persistenceReady && !force) {
    return { ok: true, deferred: true };
  }

  void (async () => {
    pendingDbWrites += 1;
    try {
      if (await isDbApiAvailable()) {
        usingDbStorage = true;
        dbWriteInFlight = true;
        try {
          await saveStateToDb(state);
        } finally {
          dbWriteInFlight = false;
        }
        return;
      }
    } catch (err) {
      dbWriteInFlight = false;
      console.warn('AdKerala: could not save to db/info.txt', err);
      const msg =
        err.code === 'DRIVER_LOCKED'
          ? 'Not connected — re-enter the bus pair code on this phone'
          : (err.message ?? 'Could not save to bus');
      notifySaveError(msg);
    }

    saveStateLocal(state);
  })().finally(() => {
    pendingDbWrites = Math.max(0, pendingDbWrites - 1);
  });

  return { ok: true };
}

export function subscribe(fn) {
  listeners.add(fn);

  const onStorage = (e) => {
    if (usingDbStorage) return;
    if (e.key === STORAGE_KEY && e.newValue) {
      try {
        fn((prev) => mergeStoredIntoPrev(prev, JSON.parse(e.newValue)));
      } catch {
        /* ignore */
      }
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function mergeRemoteState(prev, remoteHydrated) {
  return mergeStoredIntoPrev(prev, remoteHydrated);
}

export function generatePairingCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function createId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getActiveRoute(state) {
  return (state.routes ?? []).find((r) => r.id === state.activeRouteId) ?? null;
}

function sameStop(a, b) {
  const enA = normalizeStop(a).en;
  const enB = normalizeStop(b).en;
  if (!enA || !enB) return false;
  return enA.toLowerCase() === enB.toLowerCase();
}

/** Normalize legacy string stops or { en, ml, lat, lng } objects. */
export function normalizeStop(stop) {
  if (!stop) return { en: '', ml: '', lat: null, lng: null, radiusM: 80 };
  if (typeof stop === 'string') {
    return { en: stop.trim(), ml: '', lat: null, lng: null, radiusM: 80 };
  }
  const lat = stop.lat != null && stop.lat !== '' ? Number(stop.lat) : null;
  const lng = stop.lng != null && stop.lng !== '' ? Number(stop.lng) : null;
  return {
    en: String(stop.en ?? '').trim(),
    ml: String(stop.ml ?? '').trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    radiusM: Number.isFinite(Number(stop.radiusM)) ? Number(stop.radiusM) : 80,
  };
}

export function getStopEn(stop) {
  return normalizeStop(stop).en;
}

/** Find a route stop by English name (for announcement ↔ display sync). */
export function findStopByEn(stops, stopEn) {
  if (!stopEn) return null;
  const key = String(stopEn).trim().toLowerCase();
  return (
    (stops ?? []).find((st) => normalizeStop(st).en.toLowerCase() === key) ?? {
      en: String(stopEn).trim(),
      ml: '',
    }
  );
}

/** Remove middle stops that duplicate start/end or each other. */
export function normalizeRouteMiddleStops(route) {
  if (!route) return route;
  const start = normalizeStop(route.startStop);
  const end = normalizeStop(route.endStop);
  const cleaned = [];

  for (const stop of coerceStopsArray(route.stops)) {
    const normalized = normalizeStop(stop);
    if (!normalized.en) continue;
    if (start.en && sameStop(normalized, start)) continue;
    if (end.en && sameStop(normalized, end)) continue;
    if (cleaned.some((s) => sameStop(s, normalized))) continue;
    cleaned.push(normalized);
  }

  return { ...route, startStop: start, endStop: end, stops: cleaned };
}

/** Combine stop fields so cloud-pushed Malayalam is not lost when the phone saves GPS. */
function mergeStopFields(a, b) {
  const left = normalizeStop(a);
  const right = normalizeStop(b);
  return {
    en: right.en || left.en,
    ml: right.ml || left.ml,
    lat: right.lat ?? left.lat,
    lng: right.lng ?? left.lng,
    radiusM: right.radiusM ?? left.radiusM,
  };
}

function stopEnKey(stop) {
  return normalizeStop(stop).en.toLowerCase();
}

function mergeMiddleStops(a = [], b = []) {
  const byEn = new Map();
  for (const stop of a ?? []) {
    const key = stopEnKey(stop);
    if (key) byEn.set(key, stop);
  }
  for (const stop of b ?? []) {
    const key = stopEnKey(stop);
    if (!key) continue;
    const existing = byEn.get(key);
    byEn.set(key, existing ? mergeStopFields(existing, stop) : stop);
  }
  return [...byEn.values()];
}

export function mergeRouteById(existing, incoming) {
  const left = normalizeRouteMiddleStops(existing);
  const right = normalizeRouteMiddleStops(incoming);
  if (!left?.id) return right;
  if (!right?.id) return left;

  return normalizeRouteMiddleStops({
    ...left,
    ...right,
    id: right.id || left.id,
    name: right.name || left.name,
    startStop: mergeStopFields(left.startStop, right.startStop),
    endStop: mergeStopFields(left.endStop, right.endStop),
    stops: mergeMiddleStops(left.stops, right.stops),
    sharedFromCloud: right.sharedFromCloud ?? left.sharedFromCloud,
    cloudRouteId: right.cloudRouteId ?? left.cloudRouteId,
  });
}

/** Routes pushed from cloud admin (not created locally on the bus). */
export function isAssignedRoute(route) {
  return Boolean(route?.sharedFromCloud || route?.cloudRouteId);
}

/** Routes the driver control panel may use — mirrors bus PC hub state (bus3-style). */
export function getDriverVisibleRoutes(state = {}) {
  const routes = dedupeRoutes(state.routes ?? []);
  const assignedIds = state.busProfile?.assignedRouteIds;
  if (Array.isArray(assignedIds) && assignedIds.length) {
    const idSet = new Set(assignedIds);
    const filtered = routes.filter((r) => idSet.has(r.id));
    if (filtered.length) return filtered;
  }
  const shared = routes.filter(isAssignedRoute);
  if (shared.length) return shared;
  if (state.activeRouteId) {
    const active = routes.find((r) => r.id === state.activeRouteId);
    if (active) return [active];
  }
  return routes;
}

export function getAssignedRoutes(routes = []) {
  return dedupeRoutes(routes).filter(isAssignedRoute);
}

/** Merge route lists from two sync sources (used by server state merge too). */
export function mergeRoutesForSync(prevRoutes, storedRoutes, prevSaved, remoteSaved) {
  return mergeRoutesFromSync(prevRoutes, storedRoutes, prevSaved, remoteSaved);
}

/** Build ordered stop list without repeating start/end or consecutive duplicates. */
export function getAllStops(route) {
  if (!route) return [];

  const start = normalizeStop(route.startStop);
  const end = normalizeStop(route.endStop);
  const middle = coerceStopsArray(route.stops).map(normalizeStop).filter((s) => s.en);

  const result = [];
  if (start.en) result.push(start);

  for (const stop of middle) {
    const last = result[result.length - 1];
    if (sameStop(stop, last)) continue;
    if (result.length === 1 && sameStop(stop, start)) continue;
    if (end.en && sameStop(stop, end)) continue;
    result.push(stop);
  }

  if (end.en && !sameStop(end, result[result.length - 1])) {
    result.push(end);
  }

  const unique = [];
  for (const stop of result) {
    if (unique.some((s) => sameStop(s, stop))) continue;
    unique.push(stop);
  }
  return unique;
}

export function getTripStartIndex(stops, routeDirection) {
  if (!stops.length) return 0;
  return routeDirection === 'reverse' ? stops.length - 1 : 0;
}

/** Index of the most recently departed (completed) stop; before first departure, one before trip origin. */
export function getLastDepartedIndex(state, stops, routeDirection) {
  const tripStart = getTripStartIndex(stops, routeDirection);
  if (!state.tripDeparted) {
    return routeDirection === 'forward' ? tripStart - 1 : tripStart + 1;
  }
  return Math.max(0, Math.min(state.currentStopIndex, stops.length - 1));
}

/** Index of the next stop passengers should prepare for. */
export function getUpcomingStopIndex(state, stops, routeDirection) {
  const tripStart = getTripStartIndex(stops, routeDirection);
  const lastDeparted = getLastDepartedIndex(state, stops, routeDirection);

  if (routeDirection === 'forward') {
    return state.tripDeparted ? lastDeparted + 1 : tripStart + 1;
  }
  return state.tripDeparted ? lastDeparted - 1 : tripStart - 1;
}

export function getStopInfo(state) {
  const route = getActiveRoute(state);
  const stops = getAllStops(route);
  if (!stops.length) {
    return {
      current: null,
      next: null,
      final: null,
      start: null,
      index: -1,
      upcomingIndex: null,
      total: 0,
      progress: 0,
      allStops: [],
      routeDirection: 'forward',
      atTripStart: true,
      atTripEnd: false,
      lastDeparted: null,
    };
  }

  const routeDirection = state.routeDirection ?? 'forward';
  const tripStart = getTripStartIndex(stops, routeDirection);
  const lastDepartedIdx = getLastDepartedIndex(state, stops, routeDirection);
  const upcomingIdx = getUpcomingStopIndex(state, stops, routeDirection);

  const tripOrigin = routeDirection === 'forward' ? stops[0] : stops[stops.length - 1];
  const tripDestination = routeDirection === 'forward' ? stops[stops.length - 1] : stops[0];

  const upcoming =
    upcomingIdx >= 0 && upcomingIdx < stops.length ? stops[upcomingIdx] : null;
  const lastDeparted =
    lastDepartedIdx >= 0 && lastDepartedIdx < stops.length ? stops[lastDepartedIdx] : null;

  const atTripStart = Boolean(state.tripStarted) && !state.tripDeparted;
  const atTripEnd =
    Boolean(state.tripStarted) &&
    state.tripDeparted &&
    (routeDirection === 'forward'
      ? state.currentStopIndex >= stops.length - 1
      : state.currentStopIndex <= 0);

  const progress =
    routeDirection === 'forward'
      ? ((lastDepartedIdx + 2) / stops.length) * 100
      : ((stops.length - lastDepartedIdx) / stops.length) * 100;

  return {
    current: lastDeparted,
    next: upcoming,
    final: tripDestination,
    start: tripOrigin,
    index: lastDepartedIdx,
    upcomingIndex: upcomingIdx,
    total: stops.length,
    allStops: stops,
    progress: Math.min(100, Math.max(0, progress)),
    routeName: route.name,
    routeDirection,
    atTripStart,
    atTripEnd,
    tripStarted: Boolean(state.tripStarted),
    tripEnded: Boolean(state.tripEnded),
    lastDeparted,
  };
}

/**
 * Next stop for passenger display and announcements.
 * Forward is pressed when leaving a stop — audio and screen always target this upcoming stop.
 */
export function getUpcomingPassengerStop(state) {
  if (!state.tripStarted || state.tripEnded) return null;
  const info = getStopInfo(state);
  if (!info.allStops?.length) return null;
  return info.next ?? info.final;
}

export { defaultState, sameStop, dedupeRoutes };
