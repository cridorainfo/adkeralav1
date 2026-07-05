import { useCallback, useEffect, useRef, useState } from 'react';
import { busFetch, getBusOrigin, isOnBusLanOrigin } from '../lib/driverBusApi.js';
import { ensureDriverSession } from '../lib/driverConnectFlow.js';

const POLL_MS = 2000;
const POLL_MS_LIVE = 5000;
const HEARTBEAT_MS = 20000;

function canUseSameOriginEvents() {
  if (typeof window === 'undefined') return false;
  if (isOnBusLanOrigin()) return true;
  const busOrigin = getBusOrigin();
  return Boolean(busOrigin && busOrigin === window.location.origin);
}

/** Poll bus PC state over LAN and keep driver session alive. */
export function useBusLanState({ onRevoked } = {}) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(true);
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');

  const refreshState = useCallback(async () => {
    try {
      const res = await busFetch('/api/state');
      const json = await res.json();
      if (json.ok) {
        setState(json.data ?? {});
        setError('');
        setConnected(true);
        return json.data ?? {};
      }
      setError(json.error ?? 'Could not load bus state');
      setConnected(false);
    } catch (err) {
      setError(err.message ?? 'Could not reach bus — stay on bus Wi‑Fi');
      setConnected(false);
    }
    return null;
  }, []);

  const pingSession = useCallback(async () => {
    const result = await ensureDriverSession();
    if (result.reason === 'revoked') {
      setConnected(false);
      onRevoked?.(result.error);
      return { redirect: '/driver', revoked: true };
    }
    const online = Boolean(result.ok || result.keepTrying);
    setConnected(online);
    if (result.plate) setPlate(result.plate);
    if (!online && result.reason === 'need-code') {
      return { redirect: '/driver' };
    }
    return { ok: online };
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

    (async () => {
      const session = await pingSession();
      if (cancelled) return;
      if (session.redirect) return;
      await refreshState();
    })();

    schedulePoll(POLL_MS);

    if (canUseSameOriginEvents() && typeof EventSource !== 'undefined') {
      try {
        eventSource = new EventSource('/api/state/events');
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

    const heartbeatId = setInterval(async () => {
      try {
        const res = await busFetch('/api/driver/heartbeat', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (json.expired) {
          const session = await pingSession();
          if (session?.revoked) return;
        } else if (json.ok) {
          setConnected(true);
        }
      } catch {
        setConnected(false);
      }
    }, HEARTBEAT_MS);

    const sessionId = setInterval(() => {
      pingSession().catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      clearInterval(heartbeatId);
      clearInterval(sessionId);
      eventSource?.close();
    };
  }, [pingSession, refreshState]);

  return {
    state,
    connected,
    plate,
    error,
    setError,
    refreshState,
    pingSession,
  };
}
