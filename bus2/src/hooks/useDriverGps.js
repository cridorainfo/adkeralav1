import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusStore } from './useBusStore';
import { distanceMetres } from '../lib/geoUtils';
import { createPersistentGpsWatcher } from '../lib/persistentGps';
import {
  checkLocationPermission,
  requestLocationAccess,
} from '../lib/locationPermissions';

const SAVE_INTERVAL_MS = 2000;
const MOVE_THRESHOLD_M = 12;

/** Stream GPS from driver phone (/control) into bus state + display sync. */
export function useDriverGps(enabled = true) {
  const { updateDriverLocation } = useBusStore();
  const lastSaveRef = useRef(0);
  const lastSavedPosRef = useRef(null);
  const watcherRef = useRef(null);
  const [permission, setPermission] = useState('unknown');

  const persistIfNeeded = useCallback(
    (loc, force = false) => {
      const receivedAt = Date.now();
      const fix =
        loc?.lat != null && loc?.lng != null && !loc.error
          ? { ...loc, at: receivedAt }
          : { ...loc, at: loc?.at ?? receivedAt };

      let shouldPersist = force;

      if (!shouldPersist && receivedAt - lastSaveRef.current >= SAVE_INTERVAL_MS) {
        shouldPersist = true;
      }

      if (
        !shouldPersist &&
        lastSavedPosRef.current &&
        fix.lat != null &&
        fix.lng != null
      ) {
        const moved = distanceMetres(
          lastSavedPosRef.current.lat,
          lastSavedPosRef.current.lng,
          fix.lat,
          fix.lng
        );
        if (moved >= MOVE_THRESHOLD_M) shouldPersist = true;
      }

      if (shouldPersist) {
        lastSaveRef.current = receivedAt;
        if (fix.lat != null && fix.lng != null) {
          lastSavedPosRef.current = { lat: fix.lat, lng: fix.lng };
        }
      }

      updateDriverLocation(fix, shouldPersist);
    },
    [updateDriverLocation]
  );

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
      return undefined;
    }

    let cancelled = false;

    checkLocationPermission().then((state) => {
      if (!cancelled) setPermission(state);
    });

    const watcher = createPersistentGpsWatcher({
      onFix: (fix) => persistIfNeeded(fix),
      onError: (err) => persistIfNeeded(err, true),
      onPermission: setPermission,
    });
    watcherRef.current = watcher;
    void watcher.start();

    return () => {
      cancelled = true;
      watcher.stop();
      watcherRef.current = null;
    };
  }, [enabled, persistIfNeeded]);

  return { permission, requestGps };
}
