import { useEffect, useRef, useState } from 'react';
import {
  createGpsAutoDriveTracker,
  evaluateGpsDeparture,
  resetGpsAutoDriveTracker,
} from '../lib/gpsAutoDrive';

/**
 * Isolated GPS auto-forward — only runs when driveSettings.mode === 'gps'.
 * Calls moveForward() on geofence departure; does not replace manual Forward.
 */
export function useGpsAutoDrive({ enabled, state, driveSettings, moveForward }) {
  const trackerRef = useRef(createGpsAutoDriveTracker());
  const [status, setStatus] = useState(null);
  const tripKey = `${state.activeRouteId}-${state.tripStarted}-${state.tripEnded}-${state.tripDeparted}-${state.currentStopIndex}`;

  useEffect(() => {
    resetGpsAutoDriveTracker(trackerRef.current);
    setStatus(null);
  }, [state.activeRouteId, state.tripStarted, state.tripEnded]);

  useEffect(() => {
    resetGpsAutoDriveTracker(trackerRef.current);
  }, [tripKey]);

  useEffect(() => {
    if (!enabled || (driveSettings?.mode ?? 'manual') !== 'gps') {
      setStatus(null);
      return;
    }

    if (!state.tripStarted || state.tripEnded) {
      setStatus({ phase: 'idle', message: 'Start trip to enable GPS auto-drive' });
      return;
    }

    const result = evaluateGpsDeparture({
      state,
      gps: state.driverLocation,
      driveSettings,
      tracker: trackerRef.current,
    });

    if (result.action === 'forward') {
      moveForward();
      setStatus({
        phase: 'advanced',
        stopEn: result.stopEn,
        at: Date.now(),
        message: `Auto-advanced after leaving ${result.stopEn}`,
      });
      return;
    }

    if (result.status === 'inside') {
      setStatus({
        phase: 'inside',
        stopEn: result.stopEn,
        distanceM: result.distanceM,
        message: `Inside ${result.stopEn} — will advance when bus leaves`,
      });
      return;
    }

    if (result.reason === 'stop-no-coords') {
      setStatus({
        phase: 'warning',
        stopEn: result.stopEn,
        message: `${result.stopEn} has no GPS — set coordinates or use Manual mode`,
      });
      return;
    }

    if (result.reason === 'accuracy') {
      setStatus({
        phase: 'waiting',
        message: `GPS accuracy too low (${Math.round(result.accuracy)}m) — waiting…`,
      });
      return;
    }

    if (result.reason === 'cooldown') {
      setStatus({
        phase: 'cooldown',
        stopEn: result.stopEn,
        message: `Cooldown — watching ${result.stopEn}`,
      });
      return;
    }

    setStatus({
      phase: result.status ?? 'watching',
      stopEn: result.stopEn,
      distanceM: result.distanceM,
      message: result.stopEn
        ? `Watching departure from ${result.stopEn}${result.distanceM != null ? ` (${Math.round(result.distanceM)}m)` : ''}`
        : 'Waiting for GPS…',
    });
  }, [
    enabled,
    driveSettings,
    state.driverLocation,
    state.tripStarted,
    state.tripEnded,
    state.tripDeparted,
    state.currentStopIndex,
    state.activeRouteId,
    state.routeDirection,
    state.routes,
    moveForward,
  ]);

  const isGpsMode = (driveSettings?.mode ?? 'manual') === 'gps';

  return { status, isGpsMode };
}
