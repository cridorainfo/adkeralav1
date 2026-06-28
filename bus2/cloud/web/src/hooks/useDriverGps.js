import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceMetres } from '../lib/geoUtils.js';

const SAVE_INTERVAL_MS = 2000;
const MOVE_THRESHOLD_M = 12;

/** Stream phone GPS for live fleet tracking (no login required). */
export function useDriverGps(enabled = true) {
  const lastEmitRef = useRef(0);
  const lastPosRef = useRef(null);
  const watchIdRef = useRef(null);
  const [location, setLocation] = useState(null);
  const [permission, setPermission] = useState('unknown');

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
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPermission('granted');
        const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords;
        emitIfNeeded(
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
        emitIfNeeded(
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
  }, [emitIfNeeded]);

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
      emitIfNeeded({
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
      emitIfNeeded(
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
  }, [enabled, emitIfNeeded, requestGps]);

  return { location, permission, requestGps };
}
