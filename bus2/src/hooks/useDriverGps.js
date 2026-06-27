import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusStore } from './useBusStore';
import { distanceMetres } from '../lib/geoUtils';

const SAVE_INTERVAL_MS = 2000;
const MOVE_THRESHOLD_M = 12;

/** Stream GPS from driver phone (/control) into bus state + display sync. */
export function useDriverGps(enabled = true) {
  const { updateDriverLocation } = useBusStore();
  const lastSaveRef = useRef(0);
  const lastSavedPosRef = useRef(null);
  const watchIdRef = useRef(null);
  const [permission, setPermission] = useState('unknown');

  const persistIfNeeded = useCallback(
    (location, force = false) => {
      const at = location.at ?? Date.now();
      let shouldPersist = force;

      if (!shouldPersist && at - lastSaveRef.current >= SAVE_INTERVAL_MS) {
        shouldPersist = true;
      }

      if (
        !shouldPersist &&
        lastSavedPosRef.current &&
        location.lat != null &&
        location.lng != null
      ) {
        const moved = distanceMetres(
          lastSavedPosRef.current.lat,
          lastSavedPosRef.current.lng,
          location.lat,
          location.lng
        );
        if (moved >= MOVE_THRESHOLD_M) shouldPersist = true;
      }

      if (shouldPersist) {
        lastSaveRef.current = at;
        if (location.lat != null && location.lng != null) {
          lastSavedPosRef.current = { lat: location.lat, lng: location.lng };
        }
      }

      updateDriverLocation(location, shouldPersist);
    },
    [updateDriverLocation]
  );

  const requestGps = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPermission('granted');
        const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
        persistIfNeeded(
          {
            lat,
            lng,
            accuracy: accuracy ?? null,
            heading: heading ?? null,
            speed: speed ?? null,
            at: pos.timestamp,
          },
          true
        );
      },
      (err) => {
        setPermission(err.code === 1 ? 'denied' : 'error');
        persistIfNeeded(
          {
            lat: null,
            lng: null,
            accuracy: null,
            error: err.message || 'GPS unavailable',
            at: Date.now(),
          },
          true
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }, [persistIfNeeded]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!navigator.geolocation) return undefined;

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((result) => {
          setPermission(result.state);
          result.onchange = () => setPermission(result.state);
        })
        .catch(() => {});
    }

    requestGps();

    const onPosition = (pos) => {
      setPermission('granted');
      const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
      persistIfNeeded({
        lat,
        lng,
        accuracy: accuracy ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        at: pos.timestamp,
      });
    };

    const onError = (err) => {
      setPermission(err.code === 1 ? 'denied' : 'error');
      persistIfNeeded(
        {
          lat: null,
          lng: null,
          accuracy: null,
          error: err.message || 'GPS unavailable',
          at: Date.now(),
        },
        true
      );
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled, persistIfNeeded, requestGps]);

  return { permission, requestGps };
}
