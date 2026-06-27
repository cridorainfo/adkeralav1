import { getAllStops, getStopInfo, normalizeStop } from '../store/busStore';

const EARTH_RADIUS_M = 6371000;

/** Haversine distance in metres between two WGS84 points. */
export function distanceMetres(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** Stops on the active route that have coordinates. */
export function getGeocodedStops(state) {
  const stopInfo = getStopInfo(state);
  return (stopInfo.allStops ?? [])
    .map((stop, index) => ({ stop: normalizeStop(stop), index }))
    .filter(({ stop }) => stop.lat != null && stop.lng != null);
}

/** Nearest geocoded stop on the active route. */
export function findNearestStopOnRoute(state, lat, lng) {
  if (lat == null || lng == null) return null;

  let best = null;
  for (const { stop, index } of getGeocodedStops(state)) {
    const dist = distanceMetres(lat, lng, stop.lat, stop.lng);
    if (!best || dist < best.distanceM) {
      best = { stop, index, distanceM: dist };
    }
  }
  return best;
}

/** Stop within geofence radius (default 80m). */
export function findStopAtLocation(state, lat, lng) {
  const nearest = findNearestStopOnRoute(state, lat, lng);
  if (!nearest) return null;
  const radius = nearest.stop.radiusM ?? 80;
  return nearest.distanceM <= radius ? nearest : null;
}

export function formatGpsAccuracy(metres) {
  if (metres == null || Number.isNaN(metres)) return '—';
  if (metres < 20) return `${Math.round(metres)}m (good)`;
  if (metres < 80) return `${Math.round(metres)}m`;
  return `${Math.round(metres)}m (weak)`;
}
