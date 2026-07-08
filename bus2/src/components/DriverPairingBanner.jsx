import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverQrUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

function networkSetupMessage(network) {
  if (!network) return 'Detecting network for driver QR…';

  const error = network.lanProbeError ?? null;
  if (error === 'no_lan_ip') {
    return 'Connect this PC to Wi‑Fi, or turn on Mobile Hotspot (Settings → Mobile hotspot). QR appears automatically.';
  }
  if (network.lanReachable === false && network.serverListening) {
    return 'App is running — run allow-firewall.bat as administrator so phones can connect.';
  }
  if (network.lanReachable === false) {
    return 'Run allow-firewall.bat as administrator, then wait a few seconds.';
  }
  if (!network.primaryIp) {
    return 'Turn on Mobile Hotspot on this PC so driver phones can connect.';
  }
  return 'Waiting for a phone-reachable LAN address…';
}

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

  const joinUrl = buildDriverQrUrl({
    controlUrlHttp: controlLabel || null,
  });

  const setupHint = networkSetupMessage(network);
  const needsNetworkSetup = !joinUrl;
  const probeWarning = joinUrl && network?.lanReachable === false;

  if (fullscreen) {
    return (
      <div
        className={`driver-pairing-screen${joinUrl ? ' driver-pairing-screen--qr-only' : ''}`}
        role="status"
        aria-label={joinUrl ? 'Scan QR code to connect driver phone' : 'Driver network setup'}
      >
        {joinUrl ? (
          <>
            <DriverPairingQr value={joinUrl} size={320} />
            {probeWarning && (
              <p className="driver-pairing-hint driver-pairing-firewall-warn">{setupHint}</p>
            )}
          </>
        ) : (
          <div className="driver-pairing-banner-body">
            <p className="driver-pairing-screen-title">Driver phone setup</p>
            <p className="driver-pairing-hint driver-pairing-firewall-warn">{setupHint}</p>
            <p className="driver-pairing-hint">Then ask admin for the pairing code.</p>
          </div>
        )}
      </div>
    );
  }

  const qrSize = compact ? 88 : 132;

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}${
        needsNetworkSetup || probeWarning ? ' driver-pairing-banner--setup' : ''
      }`}
      role="status"
      aria-label={joinUrl ? 'Driver pairing QR' : 'Driver network setup'}
    >
      <div className="driver-pairing-banner-body">
        {joinUrl ? (
          <>
            <div className="driver-pairing-qr-wrap">
              <DriverPairingQr value={joinUrl} size={qrSize} />
            </div>
            {probeWarning ? (
              <p className="driver-pairing-hint driver-pairing-firewall-warn">{setupHint}</p>
            ) : (
              <p className="driver-pairing-hint">Ask admin for the pairing code.</p>
            )}
          </>
        ) : (
          <>
            <p className="driver-pairing-label">Driver QR waiting</p>
            <p className="driver-pairing-hint driver-pairing-firewall-warn">{setupHint}</p>
          </>
        )}
      </div>
    </div>
  );
}
