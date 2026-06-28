import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusStore } from './useBusStore';
import { distanceMetres } from '../lib/geoUtils';
import { createPersistentGpsWatcher } from '../lib/persistentGps';

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
      const at = loc.at ?? Date.now();
      let shouldPersist = force;

      if (!shouldPersist && at - lastSaveRef.current >= SAVE_INTERVAL_MS) {
        shouldPersist = true;
      }

      if (
        !shouldPersist &&
        lastSavedPosRef.current &&
        loc.lat != null &&
        loc.lng != null
      ) {
        const moved = distanceMetres(
          lastSavedPosRef.current.lat,
          lastSavedPosRef.current.lng,
          loc.lat,
          loc.lng
        );
        if (moved >= MOVE_THRESHOLD_M) shouldPersist = true;
      }

      if (shouldPersist) {
        lastSaveRef.current = at;
        if (loc.lat != null && loc.lng != null) {
          lastSavedPosRef.current = { lat: loc.lat, lng: loc.lng };
        }
      }

      updateDriverLocation(loc, shouldPersist);
    },
    [updateDriverLocation]
  );

  const requestGps = useCallback(() => {
    watcherRef.current?.requestFix?.();
  }, []);

  useEffect(() => {
    if (!enabled) {
      watcherRef.current?.stop?.();
      watcherRef.current = null;
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
      onFix: (fix) => persistIfNeeded(fix),
      onError: (err) => persistIfNeeded(err, true),
      onPermission: setPermission,
    });
    watcherRef.current = watcher;
    watcher.start();

    return () => {
      watcher.stop();
      watcherRef.current = null;
    };
  }, [enabled, persistIfNeeded]);

  return { permission, requestGps };
}
