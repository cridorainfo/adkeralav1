import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import DriverQrScanner from '../components/DriverQrScanner.jsx';
import { APP_NAME } from '../lib/brand.js';
import { bootDriverConnect } from '#hub/driverConnectBoot';
import { saveHubPairCode } from '#hub/persist';
import { connectAfterBusUrlSaved, goToHubControl, pairToHub, shouldOpenHubControl } from '#hub/client';
import { parseControlFromScan, readPairCodeFromLocation } from '../lib/driverPairing.js';
import DriverInstallPrompt from '../components/DriverInstallPrompt.jsx';

/** Driver phone — scan bus QR, pair with hub, open live control. */
export default function DriverConnect() {
  const location = useLocation();
  const navigate = useNavigate();
  const revokedMessage = location.state?.revoked
    ? location.state?.message ?? 'Admin disconnected all phones — scan the bus QR again'
    : '';
  const rejectedMessage = location.state?.rejected
    ? 'Wrong or expired pairing code — enter the current code from admin'
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
      const boot = await bootDriverConnect({
        locationSearch: location.search,
        navigate,
      });
      if (cancelled || boot.redirected) return;

      setBusUrl(boot.busUrl);

      if (boot.pairCode) {
        setPairCode(boot.pairCode);
      } else {
        const fromUrl = readPairCodeFromLocation(location.search);
        if (fromUrl) setPairCode(fromUrl);
      }

      if (boot.auto?.status === 'revoked') {
        setStatus('Disconnected by admin');
        setError(boot.auto.error ?? revokedMessage ?? 'Scan the bus QR and pair again');
        return;
      }

      if (boot.auto?.status === 'rejected') {
        setStatus('Wrong or expired pairing code');
        setError(boot.auto.error ?? rejectedMessage ?? 'Enter the current pairing code from admin');
        return;
      }

      if (boot.auto?.keepTrying && boot.busUrl) {
        setStatus('Reconnecting to saved bus…');
        goToHubControl(boot.busUrl);
        return;
      }

      if (boot.busUrl) {
        setStatus('Enter the pairing code from admin');
      } else {
        setStatus('Scan the QR on the bus display');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, navigate, revokedMessage, rejectedMessage]);

  const handlePairCodeChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setPairCode(digits);
  };

  const handleQrScan = async (raw) => {
    setError('');
    const control = parseControlFromScan(raw);
    if (!control) {
      setError('Unrecognized QR — scan the code on the passenger display');
      return;
    }

    setBusy(true);
    try {
      const auto = await connectAfterBusUrlSaved(control);
      setBusUrl(control);

      if (shouldOpenHubControl(auto)) {
        goToHubControl(auto.controlUrl);
        return;
      }

      if (auto.status === 'revoked') {
        setStatus('Disconnected by admin');
        setError(auto.error ?? revokedMessage ?? 'Scan the bus QR and pair again');
        return;
      }

      setStatus('Enter the pairing code from admin');
      setScannerOpen(false);
      if (auto.error) setError(auto.error);
    } finally {
      setBusy(false);
    }
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
      const result = await pairToHub(busUrl, pairCode);
      if (!result.ok) {
        setError(result.error ?? 'Could not connect');
        return;
      }
      if (pairCode.length === 4) saveHubPairCode(pairCode);
      goToHubControl(busUrl);
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
              disabled={busy}
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
                autoComplete="off"
                maxLength={4}
                placeholder="e.g. 4821"
                value={pairCode}
                onChange={(e) => handlePairCodeChange(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || pairCode.length !== 4}>
                {busy ? 'Connecting…' : 'Connect to bus'}
              </button>
              {error && <p className="driver-connect-error">{error}</p>}
              {(revokedMessage || rejectedMessage) && !error && (
                <p className="driver-connect-error" role="alert">
                  {revokedMessage || rejectedMessage}
                </p>
              )}
            </form>
            <button
              type="button"
              className="btn btn-ghost driver-rescan-btn"
              onClick={() => setScannerOpen(true)}
              disabled={busy}
            >
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
            {(revokedMessage || rejectedMessage) && !error && (
              <p className="driver-connect-error" role="alert">
                {revokedMessage || rejectedMessage}
              </p>
            )}
          </div>
        )}

        <p className="driver-connect-foot">
          Stays connected until you tap Disconnect or admin changes the pairing code.
        </p>
        <p className="driver-connect-foot">
          <Link to="/driver/gps-test">GPS test mode (no bus Wi‑Fi needed)</Link>
        </p>
      </div>

      <DriverQrScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleQrScan} />
    </div>
  );
}
