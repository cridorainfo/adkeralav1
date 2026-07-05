import { useCallback, useEffect, useState } from 'react';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME } from '../lib/brand.js';
import { loadLastControlUrl, navigateToBusControl } from '../lib/driverLanStorage.js';
import DriverQrScanner from '../components/DriverQrScanner.jsx';
import DriverInstallPrompt from '../components/DriverInstallPrompt.jsx';

/**
 * Driver phone — LAN only. Scan the bus display QR to open control on the bus PC.
 * This page never pairs with or drives through the cloud.
 */
export default function DriverConnect() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lastControl, setLastControl] = useState(null);

  useEffect(() => {
    setLastControl(loadLastControlUrl());
  }, []);

  const handleScanResult = useCallback((code, raw) => {
    if (navigateToBusControl(raw)) return;
    const digits = String(code ?? '')
      .replace(/\D/g, '')
      .slice(0, 4);
    if (digits.length === 4 && lastControl) {
      try {
        const url = new URL(lastControl);
        url.searchParams.set('code', digits);
        navigateToBusControl(url.toString());
      } catch {
        /* ignore */
      }
    }
  }, [lastControl]);

  return (
    <div className="driver-connect-page">
      <DriverQrScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanResult}
      />

      <div className="driver-connect-card driver-connect-card-wide">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} Driver</h1>
          <p>Scan the QR on the bus display — control runs on the bus Wi‑Fi only.</p>
        </div>

        <p className="driver-connect-status" role="status">
          No cloud account needed. Join the bus Wi‑Fi and scan — internet on the phone or bus is fine.
        </p>

        <DriverInstallPrompt linked={Boolean(lastControl)} />

        <button
          type="button"
          className="btn btn-primary driver-scan-btn"
          onClick={() => setScannerOpen(true)}
        >
          <span className="driver-scan-icon" aria-hidden>
            📷
          </span>
          Scan bus QR code
        </button>

        {lastControl && (
          <div className="driver-connect-actions">
            <a className="btn btn-secondary" href={lastControl}>
              Open last bus control
            </a>
          </div>
        )}

        <p className="driver-connect-foot">
          The bus PC uses internet only to sync routes, ads, and audio. Your phone only talks to that
          PC on the local network — with or without internet.
        </p>
      </div>
    </div>
  );
}
