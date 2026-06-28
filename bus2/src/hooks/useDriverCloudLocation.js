import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  sendDriverLocation,
} from '../lib/driverCloud';
import { distanceMetres } from '../lib/geoUtils';

const PUSH_INTERVAL_MS = 3000;
const MOVE_THRESHOLD_M = 12;
const LINK_CHECK_MS = 15000;

/** Push live GPS from driver phone to cloud fleet map (paired drivers only). */
export function useDriverCloudLocation({ enabled = true, location, linked: linkedProp }) {
  const lastPushRef = useRef(0);
  const lastPosRef = useRef(null);
  const driverIdRef = useRef('');
  const [linkedAuto, setLinkedAuto] = useState(false);

  const linked = linkedProp ?? linkedAuto;

  useEffect(() => {
    if (!enabled || linkedProp != null) return undefined;
    let cancelled = false;

    const checkLink = async () => {
      const driverId = await ensureDriverId();
      driverIdRef.current = driverId;
      const cloudUrl = await loadCloudUrl();
      if (!cloudUrl || cancelled) return;
      try {
        const session = await fetchDriverSession(driverId, cloudUrl);
        if (!cancelled) setLinkedAuto(Boolean(session?.linked));
      } catch {
        if (!cancelled) setLinkedAuto(false);
      }
    };

    checkLink();
    const id = setInterval(checkLink, LINK_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, linkedProp]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    ensureDriverId().then((id) => {
      if (!cancelled) driverIdRef.current = id;
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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

      const driverId = driverIdRef.current || (await ensureDriverId());
      driverIdRef.current = driverId;
      const cloudUrl = await loadCloudUrl();
      if (!cloudUrl) return;

      lastPushRef.current = at;
      lastPosRef.current = { lat: loc.lat, lng: loc.lng };
      await sendDriverLocation(driverId, loc, cloudUrl);
    },
    [enabled, linked]
  );

  useEffect(() => {
    if (!enabled || !linked || !location) return undefined;
    pushIfNeeded(location);
    return undefined;
  }, [enabled, linked, location, pushIfNeeded]);
}
