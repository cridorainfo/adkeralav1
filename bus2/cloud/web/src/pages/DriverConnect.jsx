import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import DriverQrScanner from '../components/DriverQrScanner.jsx';
import { APP_NAME } from '../lib/brand.js';
import {
  hydrateDriverStorage,
  readBusControlFromLocation,
  loadBusControlUrl,
  loadPairingCode,
  saveBusControlUrl,
  savePairingCode,
} from '../lib/driverLanStorage.js';
import { isOnBusLanOrigin } from '../lib/driverBusApi.js';
import { connectToBus, goToControl, tryStoredAutoConnect } from '../lib/driverConnectFlow.js';
import { parseControlFromScan } from '../lib/driverPairing.js';
import DriverInstallPrompt from '../components/DriverInstallPrompt.jsx';

/**
 * Driver phone — scan bus QR (opens LAN /driver), enter pairing code, then control on bus PC.
 */
export default function DriverConnect() {
  const location = useLocation();
  const navigate = useNavigate();
  const revokedMessage = location.state?.revoked
    ? location.state?.message ?? 'Admin disconnected all driver phones — scan the bus QR again'
    : '';
  const [pairCode, setPairCode] = useState('');
  const [busUrl, setBusUrl] = useState(null);
  const [status, setStatus] = useState('Checking saved bus…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await hydrateDriverStorage();

      const savedCode = loadPairingCode();
      if (savedCode && !cancelled) setPairCode(savedCode);

      const fromQr = readBusControlFromLocation(location.search);
      if (fromQr) {
        saveBusControlUrl(fromQr);
        if (!cancelled) setBusUrl(fromQr);
        navigate('/driver', { replace: true });
        return;
      }

      if (isOnBusLanOrigin()) {
        const lanControl = `${window.location.origin}/control`;
        saveBusControlUrl(lanControl);
        if (!cancelled) setBusUrl(lanControl);
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

      if (auto.reason === 'revoked') {
        setStatus('Disconnected by admin');
        setError(auto.error ?? revokedMessage ?? 'Scan the bus QR and pair again');
        return;
      }

      if (auto.reason === 'need-code' && saved) {
        setStatus('Enter the pairing code from admin');
        return;
      }

      if (auto.reason === 'connect-failed' && saved) {
        setStatus('Reconnecting to bus…');
        setError(auto.error ?? 'Could not reach bus — check Wi‑Fi');
        return;
      }

      if (saved) {
        setStatus('Enter the pairing code from admin');
      } else {
        setStatus('Scan the QR on the bus display');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, navigate]);

  const handlePairCodeChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setPairCode(digits);
    if (digits.length === 4) savePairingCode(digits);
  };

  const handleQrScan = (raw) => {
    setError('');
    const control = parseControlFromScan(raw);
    if (control) {
      saveBusControlUrl(control);
      setBusUrl(control);
      setStatus('Enter the pairing code from admin');
      return;
    }
    setError('Unrecognized QR — scan the code on the passenger display');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!busUrl) {
      setError('Scan the QR on the bus display first.');
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

        {!busUrl && (
          <div className="driver-connect-section">
            <button
              type="button"
              className="btn btn-primary driver-scan-btn"
              onClick={() => setScannerOpen(true)}
            >
              Scan QR with camera
            </button>
          </div>
        )}

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
                onChange={(e) => handlePairCodeChange(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || pairCode.length !== 4}>
                {busy ? 'Connecting…' : 'Connect to bus'}
              </button>
              {error && <p className="driver-connect-error">{error}</p>}
            {revokedMessage && !error && (
              <p className="driver-connect-error" role="alert">
                {revokedMessage}
              </p>
            )}
            </form>
            <button type="button" className="btn btn-ghost driver-rescan-btn" onClick={() => setScannerOpen(true)}>
              Scan a different bus
            </button>
          </div>
        ) : (
          <div className="driver-connect-section">
            <h2 className="driver-section-subtitle">First time on this bus</h2>
            <ol className="driver-connect-steps">
              <li>Add this page to your home screen (Install app banner above)</li>
              <li>Tap <strong>Scan QR with camera</strong> and point at the passenger display</li>
              <li>Ask admin for the pairing code and enter it here</li>
            </ol>
            {error && <p className="driver-connect-error">{error}</p>}
            {revokedMessage && !error && (
              <p className="driver-connect-error" role="alert">
                {revokedMessage}
              </p>
            )}
          </div>
        )}

        <p className="driver-connect-foot">
          Credentials stay saved in this browser/PWA until you tap Disconnect on the control screen.
        </p>
      </div>

      <DriverQrScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleQrScan}
      />
    </div>
  );
}
