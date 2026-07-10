import { useEffect, useRef, useState } from 'react';
import {
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  pairDriver,
} from '../lib/driverPhone.js';
import { loadHubPairCode } from '#hub/persist';
import { startNativeTracking, stopNativeTracking } from '../lib/nativeGpsTracker.js';

const RETRY_MS = 20000;

/**
 * Auto-links this phone's cloud driverId to the bus it's already paired with over
 * LAN hub (reuses the same 4-digit pairing code — no separate cloud pairing step
 * shown to the driver). Required before useDriverCloudLocation will push GPS.
 *
 * Keeps polling even after linking so a server-side unlink (admin action) is
 * detected and the native Android tracker is stopped — "stream until unlink"
 * has to work in both directions.
 */
export function useAutoLinkDriverCloud(plate) {
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState(null);
  const attemptingRef = useRef(false);
  const wasLinkedRef = useRef(false);

  useEffect(() => {
    if (!plate) return undefined;
    let cancelled = false;

    const applyLinked = async (isLinked, driverId, cloudUrl) => {
      if (cancelled) return;
      setLinked(isLinked);
      if (isLinked && !wasLinkedRef.current) {
        await startNativeTracking({ driverId, cloudUrl });
      } else if (!isLinked && wasLinkedRef.current) {
        await stopNativeTracking();
      }
      wasLinkedRef.current = isLinked;
    };

    const attempt = async () => {
      if (attemptingRef.current) return;
      attemptingRef.current = true;
      try {
        const driverId = ensureDriverId();
        const cloudUrl = loadCloudUrl();
        if (!cloudUrl) {
          if (!cancelled) setError('Cloud URL not configured');
          return;
        }

        const session = await fetchDriverSession(driverId, cloudUrl);
        if (session?.linked) {
          await applyLinked(true, driverId, cloudUrl);
          if (!cancelled) setError(null);
          return;
        }

        if (wasLinkedRef.current) {
          // Was linked, server says not anymore — admin unlinked from the dashboard.
          await applyLinked(false, driverId, cloudUrl);
        }

        const pairCode = loadHubPairCode();
        if (!pairCode) {
          if (!cancelled) setError('No pairing code stored yet');
          return;
        }

        const result = await pairDriver(driverId, pairCode, cloudUrl);
        if (cancelled) return;
        if (result?.ok) {
          await applyLinked(true, driverId, cloudUrl);
          setError(null);
          return;
        }

        // Re-check session — "already linked" from a previous run still counts as linked.
        const recheck = await fetchDriverSession(driverId, cloudUrl);
        if (cancelled) return;
        if (recheck?.linked) {
          await applyLinked(true, driverId, cloudUrl);
          setError(null);
        } else {
          setError(result?.error ?? 'Could not link to cloud');
        }
      } catch (err) {
        if (!cancelled) setError(err?.message ?? 'Link check failed');
      } finally {
        attemptingRef.current = false;
      }
    };

    attempt();
    const id = setInterval(attempt, RETRY_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate]);

  return { linked, error };
}
