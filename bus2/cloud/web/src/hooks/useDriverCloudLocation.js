import { useCallback, useEffect, useRef } from 'react';
import { distanceMetres } from '../lib/geoUtils.js';
import { ensureDriverId, loadCloudUrl, sendDriverLocation } from '../lib/driverPhone.js';

const PUSH_INTERVAL_MS = 3000;
const MOVE_THRESHOLD_M = 12;

export function useDriverCloudLocation({ enabled = true, location, linked = false, driverId }) {
  const lastPushRef = useRef(0);
  const lastPosRef = useRef(null);
  const driverIdRef = useRef(driverId ?? '');

  useEffect(() => {
    if (driverId) driverIdRef.current = driverId;
  }, [driverId]);

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
      await sendDriverLocation(id, loc, cloudUrl);
    },
    [enabled, linked]
  );

  useEffect(() => {
    if (!enabled || !linked || !location) return undefined;
    pushIfNeeded(location);
    return undefined;
  }, [enabled, linked, location, pushIfNeeded]);
}
