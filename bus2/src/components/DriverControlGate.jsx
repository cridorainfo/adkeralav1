import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { readPairingCodeFromLocation } from '../lib/driverJoinUrl';
import {
  clearDriverCredentials,
  getStoredDriverPlate,
  getStoredDriverToken,
  saveDriverCredentials,
} from '../lib/driverCredentials';
import { isBusPcForSerial } from '../lib/appRole';
import { DriverControlContext } from './DriverControlContext';

/** Gate /control — requires bus pairing code + admin OTP before showing the panel. */
export default function DriverControlGate({ children }) {
  const location = useLocation();
  const [checking, setChecking] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [otp, setOtp] = useState('');
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

  const tryCloudPairedUnlock = useCallback(async () => {
    const params = new URLSearchParams(location.search);
    const driverId = params.get('driverId')?.trim();
    if (!driverId) return false;

    try {
      const res = await fetch('/api/driver/unlock-paired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driverId }),
      });
      const json = await res.json();
      if (!json.ok) return false;
      saveDriverCredentials({ token: json.token, plate: json.plate ?? '' });
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
    setOtp('');
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/driver/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode, otp }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? 'Verification failed');
        return;
      }
      saveDriverCredentials({ token: json.token, plate: json.plate ?? '' });
      setPlate(json.plate ?? '');
      setUnlocked(true);
      setOtp('');
    } catch {
      setError('Could not reach bus — check Wi‑Fi');
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
          <h1>Driver unlock</h1>
          <p className="driver-control-gate-lead">
            {pairingCode
              ? 'Pair code from QR is filled in — enter admin OTP, or pair first at adkerala.com/driver and open this page from the app.'
              : 'Scan the bus QR at adkerala.com/driver, or enter the pair code and admin OTP.'}
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
            <label className="driver-control-gate-field">
              <span>Admin OTP (6 digits)</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="From admin dashboard"
                required
              />
            </label>
            {error && <p className="driver-control-gate-error">{error}</p>}
            <button type="submit" className="btn btn-primary driver-control-gate-submit" disabled={busy}>
              {busy ? 'Verifying…' : 'Unlock control panel'}
            </button>
          </form>
          <p className="driver-control-gate-hint">
            Same bus Wi‑Fi as the display PC. Pair code + admin OTP work offline after the bus has synced
            once online. Credentials stay on this phone until you disconnect.
          </p>
        </div>
      </div>
    );
  }

  return (
    <DriverControlContext.Provider value={ctx}>
      {plate && (
        <div className="driver-control-unlocked-bar" role="status">
          <span>Unlocked — {plate}</span>
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
