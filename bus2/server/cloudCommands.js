import { dedupeRoutes, normalizeRouteMiddleStops, mergeRouteById } from '../src/store/busStore.js';
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

function resolveAssignedRouteIds(next, routeId, payloadIds) {
  if (Array.isArray(payloadIds)) {
    return [...new Set(payloadIds.filter(Boolean))];
  }
  return [...new Set([...(next.busProfile?.assignedRouteIds ?? []), routeId].filter(Boolean))];
}

/** Keep all server-assigned routes on the bus; merge one route update into the list. */
function mergeAssignedRouteList(next, route, assignedRouteIds) {
  const existing = (next.routes ?? []).find((r) => r.id === route.id);
  const mergedRoute = {
    ...(existing ? mergeRouteById(existing, route) : route),
    sharedFromCloud: true,
    cloudRouteId: route.id,
  };
  const assignedIds = resolveAssignedRouteIds(next, route.id, assignedRouteIds);
  const assignedSet = new Set(assignedIds);
  const routeById = new Map((next.routes ?? []).map((r) => [r.id, r]));
  routeById.set(route.id, mergedRoute);
  const routes = dedupeRoutes(
    [...assignedSet]
      .map((id) => routeById.get(id))
      .filter(Boolean)
  );
  if (!routes.some((r) => r.id === route.id)) {
    routes.push(mergedRoute);
  }
  return { routes: dedupeRoutes(routes), assignedRouteIds: assignedIds };
}

/** Apply a cloud command payload onto bus state read from info.txt. */
export function applyCloudCommands(current, commands) {
  let next = { ...(current ?? {}) };

  for (const cmd of commands) {
    const { type, payload } = cmd;
    if (!payload) continue;

    switch (type) {
      case 'UPDATE_ADS': {
        const { ads, bannerAds, savedAt, adsSavedAt } = payload;
        next = {
          ...next,
          ...(Array.isArray(ads) ? { ads } : {}),
          ...(Array.isArray(bannerAds) ? { bannerAds } : {}),
          adsSavedAt: adsSavedAt ?? savedAt ?? Date.now(),
          savedAt: savedAt ?? Date.now(),
        };
        break;
      }

      case 'MERGE_STATE': {
        const { stopAudio, audioFragments, routes, savedAt, driverLink, busProfile, ...rest } =
          payload;
        if (Array.isArray(routes)) {
          const byId = new Map();
          for (const r of next.routes ?? []) {
            if (r?.id) byId.set(r.id, r);
          }
          for (const r of dedupeRoutes(routes)) {
            const existing = byId.get(r.id);
            byId.set(r.id, existing ? mergeRouteById(existing, r) : r);
          }
          next.routes = dedupeRoutes([...byId.values()]);
        }
        next = {
          ...next,
          ...rest,
          ...(stopAudio ? { stopAudio: mergeAudioMap(next.stopAudio, stopAudio) } : {}),
          ...(audioFragments
            ? { audioFragments: mergeAudioMap(next.audioFragments, audioFragments) }
            : {}),
          savedAt: payload.savedAt ?? Date.now(),
          lastCloudPushAt: Math.max(next.lastCloudPushAt ?? 0, payload.lastCloudPushAt ?? Date.now()),
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
        const { routes, assignedRouteIds } = mergeAssignedRouteList(
          next,
          route,
          payload.assignedRouteIds
        );
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
          busProfile: {
            ...(next.busProfile ?? {}),
            assignedRouteIds,
          },
          savedAt: payload.savedAt ?? Date.now(),
        };
        break;
      }

      case 'UPSERT_ROUTE': {
        const route = normalizeRouteMiddleStops(payload.route);
        if (!route?.id) break;
        const { routes, assignedRouteIds } = mergeAssignedRouteList(
          next,
          route,
          payload.assignedRouteIds
        );
        next = {
          ...next,
          routes,
          busProfile: {
            ...(next.busProfile ?? {}),
            assignedRouteIds,
          },
          savedAt: payload.savedAt ?? Date.now(),
        };
        break;
      }

      case 'DELETE_ROUTE': {
        const routeId = payload.routeId;
        if (!routeId) break;
        const routes = (next.routes ?? []).filter((r) => r.id !== routeId);
        let activeRouteId = next.activeRouteId;
        if (activeRouteId === routeId) {
          activeRouteId = routes[0]?.id ?? null;
          next.tripStarted = false;
          next.tripEnded = false;
          next.tripDeparted = false;
          next.currentStopIndex = 0;
        }
        const assignedIds = (next.busProfile?.assignedRouteIds ?? []).filter((id) => id !== routeId);
        next.busProfile = { ...(next.busProfile ?? {}), assignedRouteIds: assignedIds };
        next = { ...next, routes, activeRouteId, savedAt: payload.savedAt ?? Date.now() };
        break;
      }

      case 'SYNC_ASSIGNED_ROUTES': {
        const payloadRoutes = (payload.routes ?? [])
          .map((r) => normalizeRouteMiddleStops(r))
          .filter((r) => r?.id);
        const assignedIds = payload.assignedRouteIds ?? payloadRoutes.map((r) => r.id);
        const assignedSet = new Set(assignedIds);
        const mergedRoutes = payloadRoutes.map((r) => {
          const existing = (next.routes ?? []).find((x) => x.id === r.id);
          return {
            ...(existing ? mergeRouteById(existing, r) : r),
            sharedFromCloud: true,
            cloudRouteId: r.id,
          };
        });
        next.routes = dedupeRoutes(mergedRoutes);
        if (next.activeRouteId && !assignedSet.has(next.activeRouteId)) {
          next.activeRouteId = next.routes[0]?.id ?? null;
          next.tripStarted = false;
          next.tripEnded = false;
          next.tripDeparted = false;
          next.currentStopIndex = 0;
        }
        next.busProfile = {
          ...(next.busProfile ?? {}),
          assignedRouteIds: [...assignedSet],
        };
        next.savedAt = payload.savedAt ?? Date.now();
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

/** Collect relative media paths from ad objects (mediaFile / audioFile). */
function collectAdMediaFromList(ads = []) {
  const paths = [];
  for (const ad of ads) {
    if (ad?.mediaFile && typeof ad.mediaFile === 'string') paths.push(ad.mediaFile);
    if (ad?.audioFile && typeof ad.audioFile === 'string') paths.push(ad.audioFile);
  }
  return paths;
}

/** Collect ad/banner paths from bus state (for catch-up sync). */
export function collectAdMediaFromState(state = {}) {
  return [
    ...collectAdMediaFromList(state.ads),
    ...collectAdMediaFromList(state.bannerAds),
  ];
}

/** Collect stop + phrase audio paths from bus state. */
export function collectAudioMediaFromState(state = {}) {
  const paths = new Set();
  for (const map of [state.stopAudio, state.audioFragments]) {
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
    if (Array.isArray(payload.removedMediaFiles)) {
      for (const rel of payload.removedMediaFiles) {
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
    for (const rel of collectAdMediaFromList(payload.ads)) paths.add(rel);
    for (const rel of collectAdMediaFromList(payload.bannerAds)) paths.add(rel);
  }
  return [...paths];
}
