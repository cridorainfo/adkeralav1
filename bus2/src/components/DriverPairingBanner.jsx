import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverQrUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display — QR while waiting for driver pairing. */
export default function DriverPairingBanner({
  visible = true,
  compact = false,
  fullscreen = false,
}) {
  const network = useNetworkUrls();
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const lanIp = network?.primaryIp ?? null;
  const controlPort = network?.port ?? 5174;
  const allControlUrls = (network?.controlUrls ?? []).filter((u) => u.controlUrl);

  if (!visible) {
    return null;
  }

  const hasNetwork = Boolean(controlUrlHttp || lanIp || allControlUrls.length);
  if (!hasNetwork && !fullscreen) return null;

  const controlLabel =
    controlUrlHttp || (lanIp ? `http://${lanIp}:${controlPort}/control` : '');

  const joinUrl = buildDriverQrUrl({
    controlUrlHttp: controlUrlHttp || controlLabel || null,
    cloudDriverUrl: network?.cloudDriverUrl ?? null,
  });

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
      </div>
    </div>
  );
}
