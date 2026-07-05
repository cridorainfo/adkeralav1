import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME } from '../lib/brand.js';
import { readBusControlFromLocation, loadBusControlUrl, saveBusControlUrl } from '../lib/driverLanStorage.js';
import { connectToBus, goToControl, tryStoredAutoConnect } from '../lib/driverConnectFlow.js';
import DriverInstallPrompt from '../components/DriverInstallPrompt.jsx';

/**
 * Driver phone — scan bus QR with phone camera (not in-app scanner).
 * Saves bus URL, admin pairing code, then auto-connects on next launch.
 */
export default function DriverConnect() {
  const location = useLocation();
  const navigate = useNavigate();
  const [pairCode, setPairCode] = useState('');
  const [busUrl, setBusUrl] = useState(null);
  const [status, setStatus] = useState('Checking saved bus…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const fromQr = readBusControlFromLocation(location.search);
      if (fromQr) {
        saveBusControlUrl(fromQr);
        navigate('/driver', { replace: true });
        return;
      }

      const saved = loadBusControlUrl();
      if (!cancelled) setBusUrl(saved);

      const auto = await tryStoredAutoConnect();
      if (cancelled) return;

      if (auto.ok) {
        setStatus('Connecting to your bus…');
        goToControl(auto.controlUrl);
        return;
      }

      if (auto.reason === 'need-code' && saved) {
        setStatus('Enter the pairing code from admin');
        return;
      }

      if (saved) {
        setStatus('Enter the pairing code from admin');
      } else {
        setStatus('Scan the QR on the bus display with your phone camera');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!busUrl) {
      setError('Scan the QR on the bus display first — use your phone camera app.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await connectToBus(busUrl, pairCode);
      if (!result.ok) {
        setError(result.error ?? 'Could not connect');
        return;
      }
      goToControl(result.controlUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="driver-connect-page">
      <div className="driver-connect-card driver-connect-card-wide">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} Driver</h1>
          <p className="driver-connect-status" role="status">
            {status}
          </p>
        </div>

        <DriverInstallPrompt linked={Boolean(busUrl)} />

        {busUrl ? (
          <div className="driver-connect-section">
            <p className="hint">
              Bus linked. Ask <strong>admin</strong> for the pairing code, then enter it below.
            </p>
            <form onSubmit={handleSubmit}>
              <label htmlFor="pairCode">Pairing code from admin (4 digits)</label>
              <input
                id="pairCode"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="e.g. 4821"
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || pairCode.length !== 4}>
                {busy ? 'Connecting…' : 'Connect to bus'}
              </button>
              {error && <p className="driver-connect-error">{error}</p>}
            </form>
          </div>
        ) : (
          <div className="driver-connect-section">
            <h2 className="driver-section-subtitle">First time on this bus</h2>
            <ol className="driver-connect-steps">
              <li>Open your phone&apos;s <strong>camera</strong> app</li>
              <li>Scan the QR on the passenger display</li>
              <li>Open the link — this app saves the bus address</li>
              <li>Ask admin for the pairing code and enter it here</li>
            </ol>
            {error && <p className="driver-connect-error">{error}</p>}
          </div>
        )}

        <p className="driver-connect-foot">
          After the first setup, this app connects automatically. Disconnect on the control screen to
          switch buses — then scan the display QR again with your camera.
        </p>
      </div>
    </div>
  );
}
