import {
  getActiveRoute,
  getAllStops,
  getTripStartIndex,
  getStopInfo,
  getUpcomingStopIndex,
} from '../store/busStore';
import { distanceMetres } from './geoUtils';

/** Mutable tracker — kept in hook ref, never persisted. */
export function createGpsAutoDriveTracker() {
  return {
    insideKey: null,
    wasInside: false,
    lastForwardAt: 0,
  };
}

/** Which stop geofence we watch for departure (separate from manual Forward logic). */
export function getDepartureWatchStop(state) {
  const route = getActiveRoute(state);
  if (!route || !state.tripStarted || state.tripEnded) return null;

  const stops = getAllStops(route);
  if (!stops.length) return null;

  const dir = state.routeDirection ?? 'forward';
  const tripStart = getTripStartIndex(stops, dir);
  const stopInfo = getStopInfo(state);
  if (stopInfo.atTripEnd) return null;

  if (!state.tripDeparted) {
    const stop = stops[tripStart];
    if (!stop?.en) return null;
    return { stop, index: tripStart, key: `origin-${tripStart}` };
  }

  const upcomingIdx = getUpcomingStopIndex(state, stops, dir);
  if (upcomingIdx < 0 || upcomingIdx >= stops.length) return null;

  const stop = stops[upcomingIdx];
  if (!stop?.en) return null;
  return { stop, index: upcomingIdx, key: `upcoming-${upcomingIdx}` };
}

/**
 * Evaluate GPS departure — returns { action: 'forward' | 'none', ... }.
 * Does not mutate bus state; caller invokes moveForward() when action is 'forward'.
 */
export function evaluateGpsDeparture({ state, gps, driveSettings, tracker }) {
  const mode = driveSettings?.mode ?? 'manual';
  if (mode !== 'gps') {
    return { action: 'none', reason: 'manual-mode' };
  }

  if (driveSettings?.autoForward === false) {
    return { action: 'none', reason: 'auto-disabled' };
  }

  if (!gps?.lat || !gps?.lng || gps.error) {
    return { action: 'none', reason: 'no-gps' };
  }

  const maxAcc = driveSettings?.minAccuracyM ?? 60;
  if (gps.accuracy != null && gps.accuracy > maxAcc) {
    return { action: 'none', reason: 'accuracy', accuracy: gps.accuracy };
  }

  const watch = getDepartureWatchStop(state);
  if (!watch?.stop) {
    return { action: 'none', reason: 'no-watch-stop' };
  }

  const stop = watch.stop;
  if (stop.lat == null || stop.lng == null) {
    return { action: 'none', reason: 'stop-no-coords', stopEn: stop.en };
  }

  const radius = stop.radiusM ?? 80;
  const hysteresis = driveSettings?.departureHysteresisM ?? 25;
  const exitThreshold = radius + hysteresis;
  const dist = distanceMetres(gps.lat, gps.lng, stop.lat, stop.lng);

  const inside = dist <= radius;
  const outsideExit = dist >= exitThreshold;

  const cooldownMs = (driveSettings?.cooldownSec ?? 20) * 1000;
  const now = Date.now();
  if (tracker.lastForwardAt && now - tracker.lastForwardAt < cooldownMs) {
    return { action: 'none', reason: 'cooldown', stopEn: stop.en, distanceM: dist };
  }

  if (inside) {
    tracker.insideKey = watch.key;
    tracker.wasInside = true;
    return {
      action: 'none',
      status: 'inside',
      stopEn: stop.en,
      distanceM: dist,
      watchKey: watch.key,
    };
  }

  if (tracker.wasInside && tracker.insideKey === watch.key && outsideExit) {
    tracker.wasInside = false;
    tracker.insideKey = null;
    tracker.lastForwardAt = now;
    return {
      action: 'forward',
      stopEn: stop.en,
      distanceM: dist,
    };
  }

  return {
    action: 'none',
    status: tracker.wasInside ? 'awaiting-exit' : 'approaching',
    stopEn: stop.en,
    distanceM: dist,
    watchKey: watch.key,
  };
}

export function resetGpsAutoDriveTracker(tracker) {
  tracker.insideKey = null;
  tracker.wasInside = false;
}
