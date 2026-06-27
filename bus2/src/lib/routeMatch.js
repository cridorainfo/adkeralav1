/** Case-insensitive stop name match (exact or substring). */
export function stopNamesMatch(a, b) {
  const x = String(a ?? '').trim().toLowerCase();
  const y = String(b ?? '').trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Match routes whose start/end endpoints match the given names.
 * Returns { route, direction: 'forward' | 'reverse' }[]
 */
export function matchRoutesByEndpoints(routes = [], startEn, endEn) {
  const start = String(startEn ?? '').trim();
  const end = String(endEn ?? '').trim();
  if (!start || !end) return [];

  const hits = [];
  const seen = new Set();

  for (const route of routes) {
    if (!route?.startStop?.en || !route?.endStop?.en) continue;

    const forward =
      stopNamesMatch(route.startStop.en, start) && stopNamesMatch(route.endStop.en, end);
    const reverse =
      stopNamesMatch(route.startStop.en, end) && stopNamesMatch(route.endStop.en, start);

    if (!forward && !reverse) continue;

    const key = route.id ?? `${route.name}-${route.startStop.en}-${route.endStop.en}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      route,
      direction: forward ? 'forward' : 'reverse',
      stopCount: 2 + (route.stops?.length ?? 0),
    });
  }

  return hits.sort((a, b) => a.route.name.localeCompare(b.route.name));
}

export function formatRouteEndpoints(route) {
  const start = route.startStop?.en ?? '?';
  const end = route.endStop?.en ?? '?';
  return `${start} → ${end}`;
}

/** True when a shared cloud route is already on this bus. */
export function isCloudRouteOnBus(busRoutes = [], cloudRoute) {
  const cloudId = cloudRoute?.id;
  if (!cloudId) return false;
  return busRoutes.some((r) => r.id === cloudId || r.cloudRouteId === cloudId);
}
