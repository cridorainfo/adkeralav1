import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  sendDriverLocation,
  sendDriverLocationBeacon,
} from '../lib/driverCloud';
import { distanceMetres } from '../lib/geoUtils';

const PUSH_INTERVAL_MS = 3000;
const MOVE_THRESHOLD_M = 12;
const LINK_CHECK_MS = 15000;
const BACKGROUND_HEARTBEAT_MS = 8000;

/** Push live GPS from driver phone to cloud fleet map (paired drivers only). */
export function useDriverCloudLocation({ enabled = true, location, linked: linkedProp }) {
  const lastPushRef = useRef(0);
  const lastPosRef = useRef(null);
  const lastLocRef = useRef(null);
  const cloudUrlRef = useRef('');
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
      cloudUrlRef.current = cloudUrl ?? '';
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
    loadCloudUrl().then((url) => {
      if (!cancelled) cloudUrlRef.current = url ?? '';
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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

      const driverId = driverIdRef.current || (await ensureDriverId());
      driverIdRef.current = driverId;
      const cloudUrl = cloudUrlRef.current || (await loadCloudUrl());
      cloudUrlRef.current = cloudUrl ?? '';
      if (!cloudUrl) return;

      lastPushRef.current = at;
      lastPosRef.current = { lat: loc.lat, lng: loc.lng };
      const keepalive = document.visibilityState === 'hidden';
      await sendDriverLocation(driverId, loc, cloudUrl, { keepalive });
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
      const id = driverIdRef.current;
      const url = cloudUrlRef.current;
      if (id && url) {
        sendDriverLocationBeacon(id, loc, url);
        sendDriverLocation(id, loc, url, { keepalive: true }).catch(() => {});
      }
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
