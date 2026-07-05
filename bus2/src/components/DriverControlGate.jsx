import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  clearDriverCredentials,
  getStoredDriverPlate,
  getStoredDriverToken,
} from '../lib/driverCredentials';
import { isBusPcForSerial } from '../lib/appRole';
import { busFetch, isOnBusLanOrigin, redirectToSavedBusControl } from '../lib/driverBusApi';
import { disconnectFromBus } from '../lib/driverConnectFlow';
import { DriverControlContext } from './DriverControlContext';

/** Gate /control — requires saved token; pairing happens on /driver. */
export default function DriverControlGate({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [plate, setPlate] = useState('');

  useEffect(() => {
    if (isBusPcForSerial()) {
      setUnlocked(true);
      setPlate('Bus PC');
      setChecking(false);
      return;
    }

    if (!isOnBusLanOrigin()) {
      if (redirectToSavedBusControl()) return undefined;
      setChecking(false);
      navigate('/driver', { replace: true });
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const token = getStoredDriverToken();
      if (!token) {
        if (!cancelled) {
          setChecking(false);
          navigate('/driver', { replace: true });
        }
        return;
      }

      try {
        const res = await busFetch('/api/driver/unlock-status', {
          headers: { 'X-Driver-Token': token },
        });
        const json = await res.json();
        if (!cancelled && json.unlocked) {
          setPlate(getStoredDriverPlate());
          setUnlocked(true);
          setChecking(false);
          return;
        }
        clearDriverCredentials();
      } catch {
        clearDriverCredentials();
      }

      if (!cancelled) {
        setChecking(false);
        navigate('/driver', { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  useEffect(() => {
    if (!unlocked) return undefined;
    const token = getStoredDriverToken();
    if (!token) return undefined;

    const ping = () => {
      busFetch('/api/driver/heartbeat', {
        method: 'POST',
        headers: { 'X-Driver-Token': token },
      })
        .then((res) => res.json())
        .then((json) => {
          if (json?.expired) {
            clearDriverCredentials();
            setUnlocked(false);
            setPlate('');
            navigate('/driver', { replace: true });
          }
        })
        .catch(() => {});
    };

    ping();
    const id = setInterval(ping, 30000);
    return () => clearInterval(id);
  }, [unlocked, navigate]);

  const disconnect = useCallback(async () => {
    disconnectFromBus();
    setUnlocked(false);
    setPlate('');
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
          <span>Connected — {plate}</span>
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
