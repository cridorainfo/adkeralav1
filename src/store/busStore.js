import { readIdbState, writeIdbState } from '../lib/idbStorage';
import { fetchStateFromDb, hydrateStateFromFile, isDbApiAvailable, saveStateToDb } from '../lib/fileStorage';

const STORAGE_KEY = 'kerala-bus-state';
const CHANNEL_NAME = 'kerala-bus-sync';

const defaultState = () => ({
  routes: [],
  activeRouteId: null,
  currentStopIndex: 0,
  tripDeparted: false,
  routeDirection: 'forward',
  ads: [],
  bannerAds: [],
  adSettings: {
    enabled: true,
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
  },
  announcementSettings: {
    enabled: true,
    autoAnnounceOnForward: true,
    languages: ['ml', 'en'],
    pauseBetweenFragmentsMs: 300,
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
  serialSettings: {
    enabled: false,
    portLocked: false,
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
  currentAdIndex: 0,
  nextAdIndex: 0,
  lastAdEndedAt: Date.now(),
});

let listeners = new Set();
let channel = null;

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
      displaySettings: { ...defaults.displaySettings, ...(hydrated.displaySettings ?? {}) },
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
      audioFragments: hydrated.audioFragments ?? {},
      stopAudio: hydrated.stopAudio ?? {},
      announcementRequest: reviveAnnouncementRequest(hydrated.announcementRequest),
      announcementStatus: null,
      lastAdEndedAt: hydrated.lastAdEndedAt ?? Date.now(),
      routeDirection: hydrated.routeDirection ?? hydrated.direction ?? 'forward',
      tripDeparted: Boolean(hydrated.tripDeparted),
      nextAdIndex: hydrated.nextAdIndex ?? hydrated.currentAdIndex ?? 0,
      ads: Array.isArray(hydrated.ads) ? hydrated.ads : defaults.ads,
      driverLocation: hydrated.driverLocation ?? null,
    };
  } catch (err) {
    console.warn('AdKerala: could not load saved state, using defaults.', err);
    return defaultState();
  }
}

function mergeStoredIntoPrev(prev, parsed) {
  try {
    const stored = mergeStoredState(parsed);
    // localStorage omits in-flight requests; keep live request from BroadcastChannel.
    if (prev?.announcementRequest?.id && !stored.announcementRequest?.id) {
      return { ...stored, announcementRequest: prev.announcementRequest };
    }
    return stored;
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

/** Sync load from localStorage — used for first paint before IndexedDB hydration. */
export function loadState() {
  return readLocalStorageState() ?? defaultState();
}

/** Load from db/info.txt, then localStorage + IndexedDB fallback. */
export async function loadStateAsync() {
  try {
    if (await isDbApiAvailable()) {
      return mergeStoredState(await fetchStateFromDb());
    }
  } catch {
    /* fall through to browser storage */
  }

  const localState = readLocalStorageState();
  let idbParsed = null;

  try {
    idbParsed = await readIdbState();
  } catch {
    /* ignore */
  }

  const merged = pickNewestState(localState, idbParsed);

  if (idbParsed && (!localState || (merged.savedAt ?? 0) > (localState.savedAt ?? 0))) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateForPersistence(merged)));
    } catch {
      /* localStorage may be full; IndexedDB copy is still available */
    }
  }

  return merged;
}

function stateForPersistence(state) {
  return {
    ...state,
    announcementStatus: null,
    savedAt: Date.now(),
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

export function saveState(state) {
  // Sync open tabs immediately — do not wait for db/info.txt write.
  getChannel()?.postMessage({ type: 'STATE_UPDATE', state });

  try {
    persistToLocalStorage(stateForPersistence(state));
  } catch {
    /* localStorage quota — BroadcastChannel still delivered above */
  }

  isDbApiAvailable()
    .then((hasDb) => {
      if (!hasDb) {
        writeIdbState(stateForPersistence(state)).catch(() => {});
        return;
      }
      saveStateToDb(state).catch(() => {
        saveStateLocal(state);
      });
    })
    .catch(() => {
      saveStateLocal(state);
    });

  return { ok: true };
}

export function subscribe(fn) {
  listeners.add(fn);
  const onStorage = (e) => {
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

  const atTripStart = !state.tripDeparted;
  const atTripEnd =
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
    lastDeparted,
  };
}

/**
 * Next stop for passenger display and announcements.
 * Forward is pressed when leaving a stop — audio and screen always target this upcoming stop.
 */
export function getUpcomingPassengerStop(state) {
  const info = getStopInfo(state);
  if (!info.allStops?.length) return null;
  return info.next ?? info.final;
}

export { defaultState, sameStop, dedupeRoutes };
