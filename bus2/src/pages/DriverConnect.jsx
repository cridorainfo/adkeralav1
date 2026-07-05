import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo';
import { APP_NAME } from '../lib/brand';
import { controlUrlOnCurrentOrigin, readPairingCodeFromLocation } from '../lib/driverJoinUrl';
import { isOnBusLanOrigin } from '../lib/driverBusApi';
import { loadLastControlUrl } from '../lib/driverLanStorage';

/**
 * Driver phone entry — LAN only. Talks to this bus PC, never the cloud.
 * Scan the display QR (opens /control) or enter the pair code below.
 */
export default function DriverConnect() {
  const location = useLocation();
  const navigate = useNavigate();
  const [pairCode, setPairCode] = useState('');
  const [lastControl, setLastControl] = useState(null);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const fromUrl = readPairingCodeFromLocation(location.search);
    if (fromUrl) {
      navigate(`/control?code=${fromUrl}`, { replace: true });
      return;
    }
    setLastControl(loadLastControlUrl());
  }, [location.search, navigate]);

  const openWithCode = (e) => {
    e.preventDefault();
    setFormError('');
    const digits = pairCode.replace(/\D/g, '').slice(0, 4);
    if (digits.length !== 4) return;

    const saved = loadLastControlUrl();
    if (saved) {
      try {
        const url = new URL(saved);
        url.searchParams.set('code', digits);
        window.location.href = url.toString();
        return;
      } catch {
        /* fall through */
      }
    }

    if (isOnBusLanOrigin()) {
      window.location.href = controlUrlOnCurrentOrigin(digits);
      return;
    }

    setFormError('Scan the display QR first — it opens control on the bus PC.');
  };

  return (
    <div className="driver-connect-page">
      <div className="driver-connect-card">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} Driver</h1>
          <p>Connect on the bus Wi‑Fi — pair once with the display code. No cloud account needed.</p>
        </div>

        <div className="driver-connect-section">
          <h2 className="driver-section-subtitle">1. Scan the display QR</h2>
          <p className="hint">
            Use your phone camera on the QR shown on the passenger screen. It opens control on this
            bus PC automatically.
          </p>
        </div>

        <div className="driver-connect-section">
          <h2 className="driver-section-subtitle">2. Or enter the pair code</h2>
          <form onSubmit={openWithCode}>
            <label htmlFor="pairCode">4-digit code from the display</label>
            <input
              id="pairCode"
              type="text"
              inputMode="numeric"
              maxLength={4}
              placeholder="e.g. 4821"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <button type="submit" className="btn primary" disabled={pairCode.length !== 4}>
              Open control
            </button>
            {formError && <p className="driver-connect-error">{formError}</p>}
          </form>
        </div>

        {lastControl && (
          <div className="driver-connect-actions">
            <a className="btn secondary" href={lastControl}>
              Open last bus control
            </a>
          </div>
        )}

        <p className="driver-connect-foot">
          Stay on the same Wi‑Fi as this PC. Internet on the phone or bus does not affect driver
          control — your phone only talks to this PC. The bus PC uses internet only to sync routes,
          ads, and audio from the cloud.
        </p>

        {isOnBusLanOrigin() && (
          <Link to="/control" className="driver-connect-foot driver-connect-foot-muted">
            Already connected? Open control →
          </Link>
        )}
      </div>
    </div>
  );
}
