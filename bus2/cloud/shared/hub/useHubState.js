import { useCallback, useEffect, useRef, useState } from 'react';
import { hubApiUrl, hubFetch, isOnBusLanOrigin } from './api.js';
import {
  clearHubSetup,
  getHubToken,
  hydrateHubStorage,
  loadCachedHubState,
  loadHubControlUrl,
  saveCachedHubState,
} from './persist.js';
import {
  ensureHubConnected,
  startHubPing,
  stopHubPing,
} from './client.js';
import { mergeHubPollState } from './mergeHubPollState.js';

const POLL_MS = 1000;
const POLL_MS_LIVE = 3000;

// server/cors.js sends full CORS (echoed origin + credentials) on the SSE route specifically so
// a driver phone off the bus PC's origin — a cloud-hosted PWA, or the Capacitor app's own
// capacitor://localhost origin — can still open it cross-origin. Same-origin was never a real
// requirement; it only looked that way because the URL below used to be a bare relative path
// that only resolved correctly when window.location already was the bus PC.
function canUseHubEvents() {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return false;
  return isOnBusLanOrigin() || Boolean(loadHubControlUrl());
}

/** Poll hub state and maintain session — single ping owner via startHubPing. */
export function useHubState({ onRevoked } = {}) {
  const cached = loadCachedHubState();
  const [state, setState] = useState(cached);
  const [stateLoaded, setStateLoaded] = useState(Boolean(cached));
  const [connected, setConnected] = useState(false);
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  const revokedRef = useRef(false);

  const applyIncomingState = useCallback((prev, incoming) => {
    const merged = mergeHubPollState(prev, incoming);
    saveCachedHubState(merged);
    return merged;
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const res = await hubFetch('/api/state');
      const json = await res.json();
      if (json.ok) {
        const incoming = json.data ?? {};
        setState((prev) => applyIncomingState(prev, incoming));
        setStateLoaded(true);
        setConnected(true);
        setError('');
        return incoming;
      }
      setError(json.error ?? 'Could not load bus state');
    } catch (err) {
      setError(err.message ?? 'Could not reach bus — stay on bus Wi‑Fi');
    }
    return null;
  }, [applyIncomingState]);

  const syncSession = useCallback(async () => {
    const result = await ensureHubConnected();
    if (result.status === 'revoked') {
      revokedRef.current = true;
      clearHubSetup();
      setConnected(false);
      setState(null);
      setStateLoaded(false);
      onRevoked?.(result.error);
      return result;
    }
    const online = Boolean(result.ok && result.status === 'connected');
    setConnected(online);
    if (result.plate) setPlate(result.plate);
    if (result.status === 'need-code') return { redirect: '/driver' };
    return result;
  }, [onRevoked]);

  useEffect(() => {
    let cancelled = false;
    let pollTimer = null;
    let eventSource = null;

    const schedulePoll = (delayMs) => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        refreshState().catch(() => {});
      }, delayMs);
    };

    const bootstrap = async () => {
      await hydrateHubStorage();
      const cachedState = loadCachedHubState();
      if (cachedState && !cancelled) {
        setState(cachedState);
        setStateLoaded(true);
      }

      const earlyRefresh = getHubToken() ? refreshState().catch(() => null) : null;
      const session = await syncSession();
      if (cancelled || revokedRef.current) return;
      if (session?.redirect) return;

      if (earlyRefresh) {
        await earlyRefresh;
      } else {
        await refreshState();
      }
    };

    bootstrap().catch(() => {});

    schedulePoll(POLL_MS);

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      syncSession()
        .then((session) => {
          if (cancelled || revokedRef.current || session?.redirect) return;
          return refreshState();
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);

    if (canUseHubEvents()) {
      try {
        eventSource = new EventSource(hubApiUrl('/api/state/events'));
        eventSource.onopen = () => schedulePoll(POLL_MS_LIVE);
        eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'state-changed') refreshState().catch(() => {});
          } catch {
            /* ignore */
          }
        };
        eventSource.onerror = () => schedulePoll(POLL_MS);
      } catch {
        /* SSE unavailable */
      }
    }

    startHubPing(async (ping) => {
      if (cancelled) return;
      if (ping.revoked) {
        revokedRef.current = true;
        clearHubSetup();
        setConnected(false);
        setState(null);
        setStateLoaded(false);
        onRevoked?.('Session ended — pair again');
        return;
      }
      if (ping.ok) {
        setConnected(true);
        refreshState().catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      eventSource?.close();
      document.removeEventListener('visibilitychange', onVisible);
      stopHubPing();
    };
  }, [syncSession, refreshState, onRevoked]);

  return {
    state,
    stateLoaded,
    connected,
    plate,
    error,
    setError,
    refreshState,
    syncSession,
  };
}
