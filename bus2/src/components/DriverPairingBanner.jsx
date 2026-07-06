import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverQrUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display — QR while waiting for driver pairing. */
export default function DriverPairingBanner({
  visible = true,
  compact = false,
  fullscreen = false,
  pairingCode = '',
}) {
  const network = useNetworkUrls();
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const lanIp = network?.primaryIp ?? null;
  const controlPort = network?.port ?? 5174;
  const cloudDriverUrl = network?.cloudDriverUrl ?? null;
  const allControlUrls = (network?.controlUrls ?? []).filter((u) => u.controlUrl);
  const digits = String(pairingCode ?? '').replace(/\D/g, '').slice(0, 4);

  if (!visible) {
    return null;
  }

  const controlLabel =
    controlUrlHttp || (lanIp ? `http://${lanIp}:${controlPort}/control` : '');

  const joinUrl = buildDriverQrUrl({
    controlUrlHttp: controlUrlHttp || controlLabel || null,
    cloudDriverUrl,
  });

  if (!joinUrl && !fullscreen) {
    return null;
  }

  const needsHotspot = !controlUrlHttp && !lanIp;

  if (fullscreen) {
    if (!joinUrl) return null;
    return (
      <div
        className="driver-pairing-screen driver-pairing-screen--qr-only"
        role="img"
        aria-label="Scan QR code to connect driver phone"
      >
        <DriverPairingQr value={joinUrl} size={320} />
      </div>
    );
  }

  const qrSize = compact ? 88 : 132;

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}`}
      role="status"
      aria-label="Driver pairing QR"
    >
      <div className="driver-pairing-banner-body">
        {joinUrl && (
          <div className="driver-pairing-qr-wrap">
            <DriverPairingQr value={joinUrl} size={qrSize} />
          </div>
        )}
        {digits.length === 4 && (
          <div className="driver-pairing-code-row">
            <span className="driver-pairing-label">Pairing code</span>
            <span className="driver-pairing-code">{digits}</span>
          </div>
        )}
        {needsHotspot && (
          <p className="driver-pairing-hint driver-pairing-firewall-warn">
            No phone LAN IP — turn on bus PC hotspot or disconnect VPN, then restart.
          </p>
        )}
        {!needsHotspot && allControlUrls.length > 1 && (
          <p className="driver-pairing-hint">If scan fails, try bus hotspot Wi‑Fi.</p>
        )}
      </div>
    </div>
  );
}
