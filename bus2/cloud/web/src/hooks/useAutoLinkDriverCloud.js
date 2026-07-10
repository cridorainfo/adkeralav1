import { useEffect, useRef, useState } from 'react';
import {
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  pairDriver,
} from '../lib/driverPhone.js';
import { loadHubPairCode } from '#hub/persist';

const RETRY_MS = 20000;

/**
 * Auto-links this phone's cloud driverId to the bus it's already paired with over
 * LAN hub (reuses the same 4-digit pairing code — no separate cloud pairing step
 * shown to the driver). Required before useDriverCloudLocation will push GPS.
 */
export function useAutoLinkDriverCloud(plate) {
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState(null);
  const attemptingRef = useRef(false);

  useEffect(() => {
    if (!plate) return undefined;
    let cancelled = false;

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
          if (!cancelled) {
            setLinked(true);
            setError(null);
          }
          return;
        }

        const pairCode = loadHubPairCode();
        if (!pairCode) {
          if (!cancelled) setError('No pairing code stored yet');
          return;
        }

        const result = await pairDriver(driverId, pairCode, cloudUrl);
        if (cancelled) return;
        if (result?.ok) {
          setLinked(true);
          setError(null);
          return;
        }

        // Re-check session — "already linked" from a previous run still counts as linked.
        const recheck = await fetchDriverSession(driverId, cloudUrl);
        if (cancelled) return;
        if (recheck?.linked) {
          setLinked(true);
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
    const id = setInterval(() => {
      if (!linked) attempt();
    }, RETRY_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plate, linked]);

  return { linked, error };
}
