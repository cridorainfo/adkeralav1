import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceMetres } from '../lib/geoUtils.js';
import { createPersistentGpsWatcher } from '../lib/persistentGps.js';
import {
  checkLocationPermission,
  requestLocationAccess,
} from '../lib/locationPermissions.js';

const SAVE_INTERVAL_MS = 2000;
const MOVE_THRESHOLD_M = 12;

/** Stream phone GPS for live fleet tracking (no login required). */
export function useDriverGps(enabled = true) {
  const lastEmitRef = useRef(0);
  const lastPosRef = useRef(null);
  const watcherRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [permission, setPermission] = useState('unknown');
  const [trackingMode, setTrackingMode] = useState('idle');

  const emitIfNeeded = useCallback((next, force = false) => {
    const receivedAt = Date.now();
    const fix =
      next?.lat != null && next?.lng != null && !next.error
        ? { ...next, at: receivedAt }
        : { ...next, at: next?.at ?? receivedAt };

    let shouldEmit = force;

    if (!shouldEmit && receivedAt - lastEmitRef.current >= SAVE_INTERVAL_MS) shouldEmit = true;
    if (
      !shouldEmit &&
      lastPosRef.current &&
      fix.lat != null &&
      fix.lng != null &&
      distanceMetres(lastPosRef.current.lat, lastPosRef.current.lng, fix.lat, fix.lng) >=
        MOVE_THRESHOLD_M
    ) {
      shouldEmit = true;
    }

    if (shouldEmit) {
      lastEmitRef.current = receivedAt;
      if (fix.lat != null && fix.lng != null) {
        lastPosRef.current = { lat: fix.lat, lng: fix.lng };
      }
      setLocation(fix);
    }
  }, []);

  const requestGps = useCallback(async () => {
    const state = await requestLocationAccess();
    setPermission(state);
    const watcher = watcherRef.current;
    if (watcher) {
      await watcher.stop?.();
      await watcher.start?.();
    }
    return state;
  }, []);

  useEffect(() => {
    if (!enabled) {
      watcherRef.current?.stop?.();
      watcherRef.current = null;
      setTrackingMode('idle');
      return undefined;
    }

    let cancelled = false;
    checkLocationPermission().then((state) => {
      if (!cancelled) setPermission(state);
    });

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          if (!cancelled) setPermission(result.state);
          result.onchange = () => {
            if (!cancelled) setPermission(result.state);
          };
        })
        .catch(() => {});
    }

    const watcher = createPersistentGpsWatcher({
      onFix: (fix) => emitIfNeeded(fix),
      onError: (err) => emitIfNeeded(err, true),
      onPermission: setPermission,
    });
    watcherRef.current = watcher;
    watcher.start();
    setTrackingMode(document.visibilityState === 'hidden' ? 'background' : 'active');

    const onVis = () => {
      setTrackingMode(document.visibilityState === 'hidden' ? 'background' : 'active');
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      watcher.stop();
      watcherRef.current = null;
      setTrackingMode('idle');
    };
  }, [enabled, emitIfNeeded]);

  return { location, permission, requestGps, trackingMode };
}
