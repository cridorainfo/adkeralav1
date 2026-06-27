import { useEffect, useRef } from 'react';
import { useBusStore } from './useBusStore';

const SAVE_INTERVAL_MS = 5000;

/** Stream GPS from driver phone (/control) into bus state + cloud sync. */
export function useDriverGps(enabled = true) {
  const { updateDriverLocation } = useBusStore();
  const lastSaveRef = useRef(0);
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!navigator.geolocation) return undefined;

    const onPosition = (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
      const at = pos.timestamp;
      const location = {
        lat,
        lng,
        accuracy: accuracy ?? null,
        heading: heading ?? null,
        speed: speed ?? null,
        at,
      };

      const shouldPersist = at - lastSaveRef.current >= SAVE_INTERVAL_MS;
      if (shouldPersist) lastSaveRef.current = at;

      updateDriverLocation(location, shouldPersist);
    };

    const onError = (err) => {
      updateDriverLocation(
        {
          lat: null,
          lng: null,
          accuracy: null,
          error: err.message || 'GPS unavailable',
          at: Date.now(),
        },
        false
      );
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000,
    });

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [enabled, updateDriverLocation]);
}
