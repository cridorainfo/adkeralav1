import { dedupeRoutes, normalizeRouteMiddleStops } from '../src/store/busStore.js';
import { applyDriveAction } from '../src/store/driveActions.js';

import { mergeAudioMap } from './audioMerge.js';

function cleanStopPatch(patch) {
  if (!patch || typeof patch !== 'object') return {};
  const { targetBusIds, routeId, stopEn, savedAt, ...rest } = patch;
  const allowed = ['en', 'ml', 'lat', 'lng', 'radiusM'];
  const clean = {};
  for (const key of allowed) {
    if (rest[key] !== undefined) clean[key] = rest[key];
  }
  return clean;
}

/** Apply a cloud command payload onto bus state read from info.txt. */
export function applyCloudCommands(current, commands) {
  let next = { ...(current ?? {}) };

  for (const cmd of commands) {
    const { type, payload } = cmd;
    if (!payload) continue;

    switch (type) {
      case 'UPDATE_ADS': {
        const { ads, bannerAds, savedAt } = payload;
        next = {
          ...next,
          ...(Array.isArray(ads) ? { ads } : {}),
          ...(Array.isArray(bannerAds) ? { bannerAds } : {}),
          savedAt: savedAt ?? Date.now(),
        };
        break;
      }

      case 'MERGE_STATE': {
        const { stopAudio, audioFragments, routes, savedAt, driverLink, busProfile, ...rest } =
          payload;
        if (Array.isArray(routes)) {
          next.routes = dedupeRoutes(routes);
        }
        next = {
          ...next,
          ...rest,
          ...(stopAudio ? { stopAudio: mergeAudioMap(next.stopAudio, stopAudio) } : {}),
          ...(audioFragments
            ? { audioFragments: mergeAudioMap(next.audioFragments, audioFragments) }
            : {}),
          savedAt: savedAt ?? Date.now(),
        };
        if ('driverLink' in payload) {
          next.driverLink = driverLink ?? null;
        }
        if (busProfile && typeof busProfile === 'object') {
          next.busProfile = { ...(next.busProfile ?? {}), ...busProfile };
        }
        break;
      }

      case 'ASSIGN_ROUTE': {
        const route = normalizeRouteMiddleStops(payload.route);
        if (!route?.id) break;
        const routes = dedupeRoutes([...(next.routes ?? []).filter((r) => r.id !== route.id), route]);
        next = {
          ...next,
          routes,
          activeRouteId: payload.activeRouteId ?? route.id,
          currentStopIndex: 0,
          tripStarted: false,
          tripEnded: false,
          tripDeparted: false,
          routeDirection: 'forward',
          displayView: 'route',
          savedAt: payload.savedAt ?? Date.now(),
        };
        break;
      }

      case 'UPSERT_ROUTE': {
        const route = normalizeRouteMiddleStops(payload.route);
        if (!route?.id) break;
        const existing = (next.routes ?? []).find((r) => r.id === route.id);
        const mergedRoute = {
          ...(existing ?? {}),
          ...route,
          sharedFromCloud: route.sharedFromCloud ?? existing?.sharedFromCloud ?? false,
          cloudRouteId: route.cloudRouteId ?? existing?.cloudRouteId ?? null,
        };
        const routes = dedupeRoutes([
          ...(next.routes ?? []).filter((r) => r.id !== route.id),
          mergedRoute,
        ]);
        next = { ...next, routes, savedAt: payload.savedAt ?? Date.now() };
        break;
      }

      case 'DELETE_ROUTE': {
        const routeId = payload.routeId;
        if (!routeId) break;
        const routes = (next.routes ?? []).filter((r) => r.id !== routeId);
        let activeRouteId = next.activeRouteId;
        if (activeRouteId === routeId) {
          activeRouteId = routes[0]?.id ?? null;
        }
        next = { ...next, routes, activeRouteId, savedAt: payload.savedAt ?? Date.now() };
        break;
      }

      case 'PATCH_STOP': {
        const { routeId, stopEn, patch } = payload;
        if (!routeId || !stopEn) break;
        const stopPatch = cleanStopPatch(patch);
        const routes = (next.routes ?? []).map((route) => {
          if (route.id !== routeId) return route;
          const applyStop = (stop) => {
            if (stop?.en?.toLowerCase() !== stopEn.toLowerCase()) return stop;
            return { ...stop, ...stopPatch };
          };
          return {
            ...route,
            startStop: applyStop(route.startStop),
            endStop: applyStop(route.endStop),
            stops: (route.stops ?? []).map(applyStop),
          };
        });
        next = { ...next, routes, savedAt: payload.savedAt ?? Date.now() };
        break;
      }

      case 'DRIVE_ACTION': {
        const { action, savedAt: _savedAt, ...actionPayload } = payload;
        if (!action) break;
        next = applyDriveAction(next, action, actionPayload);
        break;
      }

      default:
        break;
    }
  }

  return next;
}

export function buildDisplaySnapshot(state) {
  if (!state) return null;
  const route = (state.routes ?? []).find((r) => r.id === state.activeRouteId);
  return {
    displayView: state.displayView ?? 'route',
    activeRouteId: state.activeRouteId,
    routeName: route?.name ?? null,
    currentStopIndex: state.currentStopIndex ?? 0,
    tripDeparted: Boolean(state.tripDeparted),
    routeDirection: state.routeDirection ?? 'forward',
    driverLocation: state.driverLocation ?? null,
    savedAt: state.savedAt ?? Date.now(),
  };
}

/** Collect relative media paths referenced in command payloads for cloud download. */
export function collectMediaDownloads(commands) {
  const paths = new Set();
  for (const cmd of commands) {
    const payload = cmd.payload ?? {};
    if (Array.isArray(payload.mediaFiles)) {
      for (const rel of payload.mediaFiles) {
        if (typeof rel === 'string' && rel) paths.add(rel);
      }
    }
    for (const map of [payload.stopAudio, payload.audioFragments]) {
      if (!map) continue;
      for (const entry of Object.values(map)) {
        for (const lang of Object.values(entry ?? {})) {
          const file = lang?.audioFile;
          if (file && typeof file === 'string') paths.add(file);
        }
      }
    }
  }
  return [...paths];
}
