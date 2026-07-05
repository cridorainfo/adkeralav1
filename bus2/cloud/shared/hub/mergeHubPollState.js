import { mergeTripFieldsFromSync } from '../../../src/store/tripMerge.js';
import { mergeBusProfile } from '../../../src/store/busProfileMerge.js';

function coerceRoutesArray(routes) {
  if (Array.isArray(routes)) return routes;
  if (routes && typeof routes === 'object' && routes.id) return [routes];
  return [];
}

function dedupeRoutes(routes) {
  const seen = new Set();
  return coerceRoutesArray(routes).filter((route) => {
    if (!route?.id || seen.has(route.id)) return false;
    seen.add(route.id);
    return true;
  });
}

function mergeRoutesFromPoll(prevRoutes, incomingRoutes, prevSaved, incomingSaved, assignedRouteIds) {
  const remoteIsNewer = incomingSaved >= prevSaved;
  const incoming = dedupeRoutes(incomingRoutes ?? []);
  const prev = dedupeRoutes(prevRoutes ?? []);

  if (!incoming.length && prev.length) {
    return prev;
  }

  if (remoteIsNewer) {
    if (incoming.length) return incoming;
    if (Array.isArray(assignedRouteIds) && assignedRouteIds.length && prev.length) {
      const idSet = new Set(assignedRouteIds);
      const kept = prev.filter((r) => idSet.has(r.id));
      if (kept.length) return kept;
    }
    return incoming;
  }

  return prev.length ? prev : incoming;
}

function ensureActiveRouteId(state = {}) {
  const routes = dedupeRoutes(state.routes ?? []);
  if (!routes.length) return state;
  let activeRouteId = state.activeRouteId ?? null;
  if (activeRouteId && routes.some((r) => r.id === activeRouteId)) return state;
  return { ...state, activeRouteId: routes[0]?.id ?? null, routes };
}

/** Merge hub poll onto prior phone state — never drop routes on a stale/empty snapshot. */
export function mergeHubPollState(prev, incoming) {
  if (!prev || typeof prev !== 'object') return incoming && typeof incoming === 'object' ? incoming : {};
  if (!incoming || typeof incoming !== 'object') return prev;

  const prevSaved = prev.savedAt ?? 0;
  const incomingSaved = incoming.savedAt ?? 0;
  const remoteIsNewer = incomingSaved >= prevSaved;
  const cloudPushAdvanced = (incoming.lastCloudPushAt ?? 0) > (prev.lastCloudPushAt ?? 0);
  const assignedRouteIds =
    incoming.busProfile?.assignedRouteIds ?? prev.busProfile?.assignedRouteIds ?? [];

  const routes = mergeRoutesFromPoll(
    prev.routes,
    incoming.routes,
    prevSaved,
    incomingSaved,
    assignedRouteIds
  );

  const serverAuthoritative = remoteIsNewer || cloudPushAdvanced;
  const liveBase = serverAuthoritative ? { ...prev, ...incoming } : { ...incoming, ...prev };

  const merged = {
    ...liveBase,
    routes,
    lastCloudPushAt: Math.max(prev.lastCloudPushAt ?? 0, incoming.lastCloudPushAt ?? 0),
  };

  if (cloudPushAdvanced && incoming.busProfile && typeof incoming.busProfile === 'object') {
    merged.busProfile = mergeBusProfile(merged.busProfile, incoming.busProfile);
  } else {
    merged.busProfile = mergeBusProfile(prev.busProfile, merged.busProfile);
  }

  mergeTripFieldsFromSync(prev, incoming, merged);

  if (!merged.activeRouteId && routes.length) {
    merged.activeRouteId = routes[0]?.id ?? null;
  } else if (merged.activeRouteId && !routes.some((r) => r.id === merged.activeRouteId)) {
    merged.activeRouteId = routes[0]?.id ?? null;
  }

  return ensureActiveRouteId(merged);
}
