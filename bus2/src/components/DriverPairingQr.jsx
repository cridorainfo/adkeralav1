import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** QR for driver phone — scan opens driver PWA with bus control URL. */
export default function DriverPairingQr({ value, size = 132, className = '' }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!value) {
      setSrc('');
      return undefined;
    }

    let cancelled = false;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#022c22', light: '#ffffff' },
    })
      .then((data) => {
        if (!cancelled) setSrc(data);
      })
      .catch(() => {
        if (!cancelled) setSrc('');
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt="Scan to open driver control on your phone"
      className={`driver-pairing-qr${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      draggable={false}
    />
  );
}
