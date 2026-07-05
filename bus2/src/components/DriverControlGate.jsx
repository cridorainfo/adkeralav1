import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getStoredDriverPlate,
  getStoredDriverToken,
} from '../lib/driverCredentials';
import { loadBusControlUrl } from '../lib/driverLanStorage';
import { isBusPcForSerial } from '../lib/appRole';
import { isOnBusLanOrigin, redirectToSavedBusControl, busFetch } from '../lib/driverBusApi';
import { disconnectFromBus, ensureDriverSession } from '../lib/driverConnectFlow';
import { DriverControlContext } from './DriverControlContext';

const HEARTBEAT_MS = 25000;

/** Gate /control — requires saved token; pairing happens on /driver. */
export default function DriverControlGate({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [plate, setPlate] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const maintainRef = useRef(false);

  const openSession = useCallback(async () => {
    const result = await ensureDriverSession();
    if (result.ok) {
      setPlate(result.plate ?? getStoredDriverPlate());
      setUnlocked(true);
      setReconnecting(false);
      return true;
    }
    if (result.keepTrying && getStoredDriverToken()) {
      setPlate(getStoredDriverPlate());
      setUnlocked(true);
      setReconnecting(true);
      return true;
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
      return;
    }

    if (!isOnBusLanOrigin()) {
      if (redirectToSavedBusControl()) return undefined;
      if (!loadBusControlUrl()) {
        setChecking(false);
        navigate('/driver', { replace: true });
        return undefined;
      }
    }

    let cancelled = false;
    maintainRef.current = true;

    (async () => {
      if (!getStoredDriverToken() && !loadBusControlUrl()) {
        if (!cancelled) {
          setChecking(false);
          navigate('/driver', { replace: true });
        }
        return;
      }

      const ok = await openSession();
      if (!cancelled) {
        setChecking(false);
        if (!ok) navigate('/driver', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
      maintainRef.current = false;
    };
  }, [location.pathname, navigate, openSession]);

  useEffect(() => {
    if (!unlocked || isBusPcForSerial()) return undefined;

    const maintain = async () => {
      if (!maintainRef.current) return;
      const token = getStoredDriverToken();
      if (!token) {
        const ok = await openSession();
        if (!ok && maintainRef.current) navigate('/driver', { replace: true });
        return;
      }

      try {
        const res = await busFetch('/api/driver/heartbeat', {
          method: 'POST',
          headers: { 'X-Driver-Token': token },
        });
        const json = await res.json();
        if (json?.ok) {
          setReconnecting(false);
          return;
        }
        if (json?.expired) {
          const ok = await openSession();
          if (!ok && maintainRef.current) navigate('/driver', { replace: true });
        }
      } catch {
        setReconnecting(true);
      }
    };

    maintain();
    const id = setInterval(maintain, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [unlocked, navigate, openSession]);

  const disconnect = useCallback(async () => {
    disconnectFromBus();
    setUnlocked(false);
    setPlate('');
    setReconnecting(false);
    navigate('/driver', { replace: true });
  }, [navigate]);

  const ctx = useMemo(() => ({ disconnect, plate }), [disconnect, plate]);

  if (checking) {
    return (
      <div className="driver-control-gate">
        <p className="driver-control-gate-status">Connecting to bus…</p>
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

export { DRIVER_TOKEN_KEY } from '../lib/driverCredentials';
