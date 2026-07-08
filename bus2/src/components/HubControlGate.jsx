import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isBusPcForSerial } from '../lib/appRole';
import { isOnBusLanOrigin, redirectToSavedHubControl } from '#hub/api';
import {
  disconnectFromHub,
  ensureHubConnected,
  startHubPing,
  stopHubPing,
} from '#hub/client';
import {
  hydrateHubStorage,
  loadHubControlUrl,
  getHubPlate,
  hasStoredDriverCredentials,
} from '#hub/persist';
import { DriverControlContext } from './DriverControlContext';

/** Gate /control — hub session required; pairing happens on /driver. */
export default function HubControlGate({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [plate, setPlate] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const maintainRef = useRef(false);

  const openSession = useCallback(async () => {
    const result = await ensureHubConnected();
    if (result.status === 'revoked') {
      setUnlocked(false);
      setPlate('');
      setReconnecting(false);
      return 'revoked';
    }
    if (result.status === 'rejected') {
      // Wrong/expired pairing code — a real rejection, not a network drop. Don't leave the
      // driver staring at a control screen stuck on "Reconnecting…" forever; send them back
      // to re-pair, same as a revoked session.
      setUnlocked(false);
      setPlate('');
      setReconnecting(false);
      return 'rejected';
    }
    if (result.ok) {
      setPlate(result.plate ?? getHubPlate());
      setUnlocked(true);
      setReconnecting(false);
      return true;
    }
    if (result.keepTrying && hasStoredDriverCredentials()) {
      setPlate(result.plate ?? getHubPlate());
      setUnlocked(true);
      setReconnecting(true);
      return 'reconnecting';
    }
    setUnlocked(false);
    setPlate('');
    setReconnecting(false);
    return false;
  }, []);

  useEffect(() => {
    if (isBusPcForSerial()) {
      setUnlocked(true);
      setPlate('Bus PC');
      setChecking(false);
      return undefined;
    }

    if (!isOnBusLanOrigin()) {
      if (redirectToSavedHubControl()) return undefined;
      if (!loadHubControlUrl()) {
        setChecking(false);
        navigate('/driver', { replace: true });
        return undefined;
      }
    }

    let cancelled = false;
    maintainRef.current = true;

    (async () => {
      await hydrateHubStorage();

      if (!loadHubControlUrl()) {
        if (!cancelled) {
          setChecking(false);
          navigate('/driver', { replace: true });
        }
        return;
      }

      const ok = await openSession();
      if (!cancelled) {
        setChecking(false);
        if (ok === 'revoked') {
          navigate('/driver', { replace: true, state: { revoked: true } });
        } else if (ok === 'rejected') {
          navigate('/driver', { replace: true, state: { rejected: true } });
        } else if (ok === false) {
          navigate('/driver', { replace: true });
        }
      }
    })();

    startHubPing(async (ping) => {
      if (!maintainRef.current || cancelled) return;
      if (ping.revoked) {
        setUnlocked(false);
        navigate('/driver', { replace: true, state: { revoked: true } });
        return;
      }
      if (ping.ok) setReconnecting(false);
      else if (ping.offline) setReconnecting(true);
    });

    return () => {
      cancelled = true;
      maintainRef.current = false;
      stopHubPing();
    };
  }, [location.pathname, navigate, openSession]);

  const disconnect = useCallback(async () => {
    await disconnectFromHub();
    setUnlocked(false);
    setPlate('');
    setReconnecting(false);
    navigate('/driver', { replace: true });
  }, [navigate]);

  const ctx = useMemo(() => ({ disconnect, plate }), [disconnect, plate]);

  if (checking) {
    return (
      <div className="driver-control-gate">
        <p className="driver-control-gate-status">Connecting to bus hub…</p>
      </div>
    );
  }

  if (!unlocked) {
    return null;
  }

  return (
    <DriverControlContext.Provider value={ctx}>
      {plate && (
        <div className="driver-control-unlocked-bar" role="status">
          <span>
            {reconnecting ? 'Reconnecting to bus…' : `Connected — ${plate}`}
          </span>
          <button type="button" className="driver-control-disconnect-btn" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      )}
      {children}
    </DriverControlContext.Provider>
  );
}
