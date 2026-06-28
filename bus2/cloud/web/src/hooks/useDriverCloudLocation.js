import { useCallback, useEffect, useRef } from 'react';
import { distanceMetres } from '../lib/geoUtils.js';
import {
  ensureDriverId,
  loadCloudUrl,
  sendDriverLocation,
  sendDriverLocationBeacon,
} from '../lib/driverPhone.js';

const PUSH_INTERVAL_MS = 3000;
const MOVE_THRESHOLD_M = 12;
const BACKGROUND_HEARTBEAT_MS = 8000;

export function useDriverCloudLocation({ enabled = true, location, linked = false, driverId }) {
  const lastPushRef = useRef(0);
  const lastPosRef = useRef(null);
  const lastLocRef = useRef(null);
  const driverIdRef = useRef(driverId ?? '');

  useEffect(() => {
    if (driverId) driverIdRef.current = driverId;
  }, [driverId]);

  useEffect(() => {
    if (location?.lat != null) lastLocRef.current = location;
  }, [location]);

  const pushIfNeeded = useCallback(
    async (loc, force = false) => {
      if (!enabled || !linked || !loc || loc.error) return;
      if (loc.lat == null || loc.lng == null) return;

      const at = loc.at ?? Date.now();
      let shouldPush = force;
      if (!shouldPush && at - lastPushRef.current >= PUSH_INTERVAL_MS) shouldPush = true;
      if (
        !shouldPush &&
        lastPosRef.current &&
        distanceMetres(lastPosRef.current.lat, lastPosRef.current.lng, loc.lat, loc.lng) >=
          MOVE_THRESHOLD_M
      ) {
        shouldPush = true;
      }
      if (!shouldPush) return;

      const id = driverIdRef.current || ensureDriverId();
      driverIdRef.current = id;
      const cloudUrl = loadCloudUrl();
      if (!cloudUrl) return;

      lastPushRef.current = at;
      lastPosRef.current = { lat: loc.lat, lng: loc.lng };
      const keepalive = document.visibilityState === 'hidden';
      await sendDriverLocation(id, loc, cloudUrl, { keepalive });
    },
    [enabled, linked]
  );

  useEffect(() => {
    if (!enabled || !linked || !location) return undefined;
    pushIfNeeded(location);
    return undefined;
  }, [enabled, linked, location, pushIfNeeded]);

  useEffect(() => {
    if (!enabled || !linked) return undefined;

    const flushBackground = () => {
      const loc = lastLocRef.current;
      if (!loc?.lat) return;
      pushIfNeeded({ ...loc, at: Date.now() }, true);
    };

    const onHide = () => {
      const loc = lastLocRef.current;
      if (!loc?.lat) return;
      const id = driverIdRef.current || ensureDriverId();
      const cloudUrl = loadCloudUrl();
      sendDriverLocationBeacon(id, loc, cloudUrl);
      sendDriverLocation(id, loc, cloudUrl, { keepalive: true }).catch(() => {});
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
      else flushBackground();
    });
    window.addEventListener('pagehide', onHide);

    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'hidden') flushBackground();
    }, BACKGROUND_HEARTBEAT_MS);

    return () => {
      window.removeEventListener('pagehide', onHide);
      clearInterval(heartbeat);
    };
  }, [enabled, linked, pushIfNeeded]);
}
