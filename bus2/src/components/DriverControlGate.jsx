import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { readPairingCodeFromLocation } from '../lib/driverJoinUrl';
import {
  clearDriverCredentials,
  getStoredDriverId,
  getStoredDriverPlate,
  getStoredDriverToken,
  saveDriverCredentials,
} from '../lib/driverCredentials';
import { isBusPcForSerial } from '../lib/appRole';
import { DriverControlContext } from './DriverControlContext';

/** Gate /control — connect once with the 4-digit pair code from the bus display (offline LAN). */
export default function DriverControlGate({ children }) {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [plate, setPlate] = useState('');

  const checkUnlock = useCallback(async () => {
    const token = getStoredDriverToken();
    if (!token) {
      setUnlocked(false);
      setPlate('');
      setChecking(false);
      return false;
    }
    try {
      const res = await fetch('/api/driver/unlock-status', {
        headers: { 'X-Driver-Token': token },
      });
      const json = await res.json();
      if (json.unlocked) {
        setPlate(getStoredDriverPlate());
        setUnlocked(true);
        return true;
      }
      clearDriverCredentials();
      setUnlocked(false);
      setPlate('');
      return false;
    } catch {
      setUnlocked(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  const tryCloudPairedUnlock = useCallback(async (driverIdOverride) => {
    const params = new URLSearchParams(location.search);
    const driverId =
      String(driverIdOverride ?? params.get('driverId') ?? getStoredDriverId() ?? '').trim();
    if (!driverId) return false;

    try {
      const res = await fetch('/api/driver/unlock-paired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId }),
      });
      const json = await res.json();
      if (!json.ok) return false;
      saveDriverCredentials({ token: json.token, plate: json.plate ?? '', driverId });
      setPlate(json.plate ?? '');
      setUnlocked(true);
      setChecking(false);
      return true;
    } catch {
      return false;
    }
  }, [location.search]);

  useEffect(() => {
    if (isBusPcForSerial()) {
      setUnlocked(true);
      setPlate('Bus PC');
      setChecking(false);
      return;
    }

    let cancelled = false;
    (async () => {
      const hadToken = await checkUnlock();
      if (cancelled || hadToken) return;
      await tryCloudPairedUnlock();
      if (!cancelled) setChecking(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [checkUnlock, tryCloudPairedUnlock]);

  useEffect(() => {
    const fromQr = readPairingCodeFromLocation(location.search);
    if (fromQr) setPairingCode(fromQr);
  }, [location.search]);

  useEffect(() => {
    if (!unlocked) return undefined;
    const token = getStoredDriverToken();
    if (!token) return undefined;

    const ping = () => {
      fetch('/api/driver/heartbeat', {
        method: 'POST',
        headers: { 'X-Driver-Token': token },
      })
        .then((res) => res.json())
        .then((json) => {
          if (json?.expired) {
            clearDriverCredentials();
            setUnlocked(false);
            setPlate('');
          }
        })
        .catch(() => {});
    };

    ping();
    const id = setInterval(ping, 30000);
    return () => clearInterval(id);
  }, [unlocked]);

  const disconnect = useCallback(async () => {
    const token = getStoredDriverToken();
    if (token) {
      await fetch('/api/driver/disconnect', {
        method: 'POST',
        headers: { 'X-Driver-Token': token },
      }).catch(() => {});
    }
    clearDriverCredentials();
    setUnlocked(false);
    setPlate('');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/driver/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Wrong code — check the bus display');
        return;
      }
      saveDriverCredentials({ token: json.token, plate: json.plate ?? '' });
      setPlate(json.plate ?? '');
      setUnlocked(true);
    } catch {
      setError('Could not reach bus — join the same Wi‑Fi as the display PC');
    } finally {
      setBusy(false);
    }
  };

  const ctx = useMemo(() => ({ disconnect, plate }), [disconnect, plate]);

  if (checking) {
    return (
      <div className="driver-control-gate">
        <p className="driver-control-gate-status">Loading…</p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="driver-control-gate">
        <div className="driver-control-gate-card">
          <h1>Connect to this bus</h1>
          <p className="driver-control-gate-lead">
            {pairingCode
              ? 'Pair code from QR is filled in — tap Connect.'
              : 'Scan the QR on the bus display, or enter the 4-digit pair code shown there.'}
          </p>
          <form onSubmit={handleSubmit} className="driver-control-gate-form">
            <label className="driver-control-gate-field">
              <span>Bus pair code (4 digits)</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="e.g. 4821"
                required
              />
            </label>
            {error && <p className="driver-control-gate-error">{error}</p>}
            <button type="submit" className="btn btn-primary driver-control-gate-submit" disabled={busy}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </form>
          <p className="driver-control-gate-hint">
            Same bus Wi‑Fi as the display PC — no internet needed. Stays connected until you disconnect or
            an admin clears phones from the fleet dashboard.
          </p>
        </div>
      </div>
    );
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
