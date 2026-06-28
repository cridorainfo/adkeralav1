import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceMetres } from '../lib/geoUtils.js';
import { createPersistentGpsWatcher } from '../lib/persistentGps.js';

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
    const at = next.at ?? Date.now();
    let shouldEmit = force;

    if (!shouldEmit && at - lastEmitRef.current >= SAVE_INTERVAL_MS) shouldEmit = true;
    if (
      !shouldEmit &&
      lastPosRef.current &&
      next.lat != null &&
      next.lng != null &&
      distanceMetres(lastPosRef.current.lat, lastPosRef.current.lng, next.lat, next.lng) >=
        MOVE_THRESHOLD_M
    ) {
      shouldEmit = true;
    }

    if (shouldEmit) {
      lastEmitRef.current = at;
      if (next.lat != null && next.lng != null) {
        lastPosRef.current = { lat: next.lat, lng: next.lng };
      }
      setLocation(next);
    }
  }, []);

  const requestGps = useCallback(() => {
    watcherRef.current?.requestFix?.();
  }, []);

  useEffect(() => {
    if (!enabled) {
      watcherRef.current?.stop?.();
      watcherRef.current = null;
      setTrackingMode('idle');
      return undefined;
    }

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          setPermission(result.state);
          result.onchange = () => setPermission(result.state);
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
      document.removeEventListener('visibilitychange', onVis);
      watcher.stop();
      watcherRef.current = null;
      setTrackingMode('idle');
    };
  }, [enabled, emitIfNeeded]);

  return { location, permission, requestGps, trackingMode };
}
