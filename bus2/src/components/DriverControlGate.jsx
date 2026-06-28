import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { readPairingCodeFromLocation } from '../lib/driverJoinUrl';

const TOKEN_KEY = 'adkerala-driver-token';

function getStoredToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

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
    const token = getStoredToken();
    if (!token) {
      setUnlocked(false);
      setChecking(false);
      return;
    }
    try {
      const res = await fetch('/api/driver/unlock-status', {
        headers: { 'X-Driver-Token': token },
      });
      const json = await res.json();
      if (json.unlocked) {
        setUnlocked(true);
      } else {
        sessionStorage.removeItem(TOKEN_KEY);
        setUnlocked(false);
      }
    } catch {
      setUnlocked(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkUnlock();
  }, [checkUnlock]);

  useEffect(() => {
    const fromQr = readPairingCodeFromLocation(location.search);
    if (fromQr) setPairingCode(fromQr);
  }, [location.search]);

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
      sessionStorage.setItem(TOKEN_KEY, json.token);
      setPlate(json.plate ?? '');
      setUnlocked(true);
    } catch {
      setError('Could not reach bus — check Wi‑Fi');
    } finally {
      setBusy(false);
    }
  };

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
              ? 'Pair code from QR is filled in — enter the 6-digit OTP from your admin.'
              : 'Enter the pair code on the bus screen (or scan the QR) and the admin OTP.'}
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
            Same OTP works for all your fleet buses until admin generates a new one. Each bus has its own pair
            code on the display.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {plate && (
        <div className="driver-control-unlocked-bar" role="status">
          Unlocked — {plate}
        </div>
      )}
      {children}
    </>
  );
}

export { TOKEN_KEY as DRIVER_CONTROL_TOKEN_KEY };
