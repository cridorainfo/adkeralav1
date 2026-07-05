import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

/** Camera QR scanner — parses bus display QR or cloud /driver?code= links. */
export default function DriverQrScanner({ open, onClose, onScan }) {
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;

    const elementId = 'driver-qr-reader';
    let cancelled = false;

    const start = async () => {
      setError('');
      try {
        const scanner = new Html5Qrcode(elementId, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            onScan?.(decoded);
            onClose?.();
          },
          () => {}
        );
        runningRef.current = true;
      } catch (err) {
        if (!cancelled) {
          setError(err?.message ?? 'Could not open camera. Allow camera access and try again.');
        }
      }
    };

    start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner && runningRef.current) {
        runningRef.current = false;
        scanner.stop().catch(() => {});
        scanner.clear().catch(() => {});
      }
    };
  }, [open, onClose, onScan]);

  if (!open) return null;

  return (
    <div className="driver-qr-overlay" role="dialog" aria-modal="true" aria-label="Scan bus QR code">
      <div className="driver-qr-sheet">
        <div className="driver-qr-sheet-header">
          <h2>Scan bus QR</h2>
          <button type="button" className="driver-qr-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="hint driver-qr-hint">Point at the QR on the passenger display.</p>
        <div id="driver-qr-reader" className="driver-qr-reader" />
        {error && (
          <p className="driver-connect-status-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
