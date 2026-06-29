import { distanceMetres } from './geoUtils.js';

/** Kerala + margin — rejects null-island placeholders and far-off bad fixes. */
export const SERVICE_BOUNDS = {
  latMin: 7.5,
  latMax: 13.5,
  lngMin: 74.0,
  lngMax: 78.5,
};

/** Max straight hop between consecutive stops (express routes ~120 km). */
const MAX_HOP_M = 150_000;

function stopKey(en) {
  return String(en ?? '')
    .trim()
    .toLowerCase();
}

function sameStop(a, b) {
  const ka = stopKey(a?.en);
  const kb = stopKey(b?.en);
  return Boolean(ka && kb && ka === kb);
}

/** Valid lat/lng for map drawing (markers + lines). */
export function isPlausibleMapCoord(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  if (Math.abs(la) < 0.01 && Math.abs(ln) < 0.01) return false;
  return (
    la >= SERVICE_BOUNDS.latMin &&
    la <= SERVICE_BOUNDS.latMax &&
    ln >= SERVICE_BOUNDS.lngMin &&
    ln <= SERVICE_BOUNDS.lngMax
  );
}

/** Normalized [lat, lng] or null if not drawable. */
export function toMapPosition(lat, lng) {
  if (!isPlausibleMapCoord(lat, lng)) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

export function stopToMapPosition(stop) {
  if (!stop) return null;
  return toMapPosition(stop.lat, stop.lng);
}

/** Same ordering/deduping as bus getAllStops — avoids double start/end points. */
export function orderedUniqueRouteStops(route) {
  if (!route) return [];
  const start = route.startStop ?? {};
  const end = route.endStop ?? {};
  const middle = (route.stops ?? []).filter((s) => s?.en);

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

function splitByMaxHop(positions) {
  if (positions.length < 2) return positions.length ? [positions] : [];
  const out = [];
  let current = [positions[0]];

  for (let i = 1; i < positions.length; i += 1) {
    const prev = positions[i - 1];
    const next = positions[i];
    const hop = distanceMetres(prev[0], prev[1], next[0], next[1]);
    if (hop > MAX_HOP_M) {
      if (current.length >= 2) out.push(current);
      current = [next];
    } else {
      current.push(next);
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
}

/**
 * Route polylines: only consecutive geocoded stops, break at gaps,
 * drop bad coords and impossible long jumps (e.g. to sea / 0,0).
 */
export function routeMapSegments(route) {
  const ordered = orderedUniqueRouteStops(route);
  const rawSegments = [];
  let current = [];

  for (const stop of ordered) {
    const pos = stopToMapPosition(stop);
    if (pos) {
      current.push([pos.lat, pos.lng]);
    } else if (current.length >= 2) {
      rawSegments.push(current);
      current = [];
    } else {
      current = [];
    }
  }
  if (current.length >= 2) rawSegments.push(current);

  return rawSegments.flatMap((segment) => splitByMaxHop(segment));
}

export function routeMapStopMarkers(route) {
  return orderedUniqueRouteStops(route)
    .map((stop) => {
      const pos = stopToMapPosition(stop);
      if (!pos) return null;
      return { ...pos, en: stop.en, ml: stop.ml };
    })
    .filter(Boolean);
}

/** Bus trail points — drop fixes outside service area and impossible hops. */
export function trailMapSegments(points = []) {
  const positions = (points ?? [])
    .map((p) => toMapPosition(p?.lat, p?.lng))
    .filter(Boolean)
    .map(({ lat, lng }) => [lat, lng]);

  return splitByMaxHop(positions);
}
