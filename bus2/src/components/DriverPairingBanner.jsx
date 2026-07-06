import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverQrUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display — LAN QR while waiting for driver pairing. */
export default function DriverPairingBanner({
  visible = true,
  compact = false,
  fullscreen = false,
}) {
  const network = useNetworkUrls();
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const lanIp = network?.primaryIp ?? null;
  const controlPort = network?.port ?? 5174;

  if (!visible) {
    return null;
  }

  const controlLabel =
    controlUrlHttp || (lanIp ? `http://${lanIp}:${controlPort}/control` : '');

  const lanReachable = network?.lanReachable !== false;
  const joinUrl = lanReachable
    ? buildDriverQrUrl({
        controlUrlHttp: controlLabel || null,
      })
    : null;

  if (!joinUrl && !fullscreen) {
    return null;
  }

  const needsHotspot = !joinUrl || network?.lanReachable === false;

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
          <>
            <div className="driver-pairing-qr-wrap">
              <DriverPairingQr value={joinUrl} size={qrSize} />
            </div>
            <p className="driver-pairing-lan" title={joinUrl}>
              {joinUrl}
            </p>
            <p className="driver-pairing-hint">Ask admin for the pairing code.</p>
          </>
        )}
        {needsHotspot && (
          <p className="driver-pairing-hint driver-pairing-firewall-warn">
            {network?.lanReachable === false
              ? 'Bus PC firewall may be blocking phones — run allow-firewall.bat as administrator.'
              : 'No phone LAN IP — turn on bus PC hotspot or disconnect VPN, then restart.'}
          </p>
        )}
      </div>
    </div>
  );
}
