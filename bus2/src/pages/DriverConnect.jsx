import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo';
import { APP_NAME } from '../lib/brand';
import { bootDriverConnect } from '#hub/driverConnectBoot';
import { saveHubPairCode } from '#hub/persist';
import { goToHubControl, pairToHub } from '#hub/client';

/** Driver entry — scan display QR, save bus hub URL, enter pairing code. */
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
      const boot = await bootDriverConnect({
        locationSearch: location.search,
        navigate,
      });
      if (cancelled || boot.redirected) return;

      setBusUrl(boot.busUrl);

      if (boot.auto?.status === 'revoked') {
        setStatus('Disconnected by admin');
        setError(boot.auto.error ?? 'Scan the bus QR and pair again');
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
        setStatus('Scan the QR on the bus display with your phone camera');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search, navigate]);

  const handlePairCodeChange = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    setPairCode(digits);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!busUrl) {
      setError('Scan the QR on the bus display first — use your phone camera app.');
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
      <div className="driver-connect-card">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} Driver</h1>
          <p className="driver-connect-status" role="status">
            {status}
          </p>
        </div>

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
              <button type="submit" className="btn primary" disabled={busy || pairCode.length !== 4}>
                {busy ? 'Connecting…' : 'Connect to bus'}
              </button>
              {error && <p className="driver-connect-error">{error}</p>}
            </form>
          </div>
        ) : (
          <div className="driver-connect-section">
            <h2 className="driver-section-subtitle">First time on this bus</h2>
            <ol className="driver-connect-steps">
              <li>Open your phone&apos;s <strong>camera</strong> and scan the QR on the passenger display</li>
              <li>Open the link — the app saves the bus hub address</li>
              <li>Ask admin for the pairing code and enter it here</li>
            </ol>
            {error && <p className="driver-connect-error">{error}</p>}
          </div>
        )}

        <p className="driver-connect-foot">
          Stays connected until you tap Disconnect or admin changes the pairing code.
        </p>
      </div>
    </div>
  );
}
