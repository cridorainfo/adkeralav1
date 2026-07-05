import { useCallback, useEffect, useRef, useState } from 'react';
import { busFetch } from '../lib/driverBusApi.js';
import { ensureDriverSession } from '../lib/driverConnectFlow.js';

const POLL_MS = 2000;
const HEARTBEAT_MS = 20000;

/** Poll bus PC state over LAN and keep driver session alive. */
export function useBusLanState({ onRevoked } = {}) {
  const [state, setState] = useState(null);
  const [connected, setConnected] = useState(true);
  const [plate, setPlate] = useState('');
  const [error, setError] = useState('');
  const stateRef = useRef(null);
  stateRef.current = state;

  const refreshState = useCallback(async () => {
    try {
      const res = await busFetch('/api/state');
      const json = await res.json();
      if (json.ok) {
        setState(json.data ?? {});
        setError('');
        return json.data ?? {};
      }
      setError(json.error ?? 'Could not load bus state');
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

    (async () => {
      const session = await pingSession();
      if (cancelled) return;
      if (session.redirect) return;
      await refreshState();
    })();

    const pollId = setInterval(() => {
      refreshState().catch(() => {});
    }, POLL_MS);

    const heartbeatId = setInterval(async () => {
      try {
        const res = await busFetch('/api/driver/heartbeat', { method: 'POST' });
        const json = await res.json().catch(() => ({}));
        if (json.expired) {
          setConnected(false);
          const session = await pingSession();
          if (session?.revoked) return;
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
      clearInterval(pollId);
      clearInterval(heartbeatId);
      clearInterval(sessionId);
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
