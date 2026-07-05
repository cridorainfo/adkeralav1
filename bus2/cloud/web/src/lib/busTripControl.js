/** Driver control trip helpers — self-contained for cloud PWA Docker build. */

function coerceRoutesArray(routes) {
  if (Array.isArray(routes)) return routes;
  if (routes && typeof routes === 'object' && routes.id) return [routes];
  return [];
}

function coerceStopsArray(stops) {
  return Array.isArray(stops) ? stops : [];
}

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

export function sameStop(a, b) {
  const enA = normalizeStop(a).en;
  const enB = normalizeStop(b).en;
  if (!enA || !enB) return false;
  return enA.toLowerCase() === enB.toLowerCase();
}

export function getStopEn(stop) {
  return normalizeStop(stop).en;
}

function normalizeRouteMiddleStops(route) {
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

function isAssignedRoute(route) {
  return Boolean(route?.sharedFromCloud || route?.cloudRouteId);
}

export function getDriverVisibleRoutes(state = {}) {
  const routes = dedupeRoutes(state.routes ?? []);
  const assignedIds = state.busProfile?.assignedRouteIds;
  if (Array.isArray(assignedIds) && assignedIds.length) {
    const idSet = new Set(assignedIds);
    const filtered = routes.filter((r) => idSet.has(r.id));
    if (filtered.length) return filtered;
    if (routes.length) return routes;
  }
  const shared = routes.filter(isAssignedRoute);
  if (shared.length) return shared;
  if (state.activeRouteId) {
    const active = routes.find((r) => r.id === state.activeRouteId);
    if (active) return [active];
  }
  return routes;
}

export function getActiveRoute(state) {
  return (state.routes ?? []).find((r) => r.id === state.activeRouteId) ?? null;
}

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

function getTripStartIndex(stops, routeDirection) {
  if (!stops.length) return 0;
  return routeDirection === 'reverse' ? stops.length - 1 : 0;
}

function getLastDepartedIndex(state, stops, routeDirection) {
  const tripStart = getTripStartIndex(stops, routeDirection);
  if (!state.tripDeparted) {
    return routeDirection === 'forward' ? tripStart - 1 : tripStart + 1;
  }
  return Math.max(0, Math.min(state.currentStopIndex, stops.length - 1));
}

function getUpcomingStopIndex(state, stops, routeDirection) {
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

export function getUpcomingPassengerStop(state) {
  if (!state.tripStarted || state.tripEnded) return null;
  const info = getStopInfo(state);
  if (!info.allStops?.length) return null;
  return info.next ?? info.final;
}
