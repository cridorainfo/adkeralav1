import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverJoinUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display overlay — plate, pairing code, and LAN URL for driver phone. */
export default function DriverPairingBanner({
  busProfile,
  connectedDeviceCount = 0,
  compact = false,
}) {
  const network = useNetworkUrls();
  const plate = busProfile?.plateDisplay || busProfile?.plate || '';
  const code = busProfile?.pairingCode ?? '';
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const lanIp = network?.primaryIp ?? null;
  const controlPort = network?.port ?? 5174;
  const firewallBlocked = network?.firewallOk === false;
  const lanReachable = network?.lanReachable;
  const lanProbeError = network?.lanProbeError;
  const allControlUrls = (network?.controlUrls ?? []).filter((u) => u.controlUrl);

  if ((connectedDeviceCount ?? 0) > 0) {
    return null;
  }

  if (!code && !controlUrlHttp && !lanIp && !allControlUrls.length) return null;

  const controlLabel =
    controlUrlHttp || (lanIp ? `http://${lanIp}:${controlPort}/control` : '');

  const joinUrl = buildDriverJoinUrl(controlUrlHttp || controlLabel);
  const qrSize = compact ? 88 : 132;
  const showBlockedWarning = lanReachable === false || firewallBlocked || lanProbeError === 'probe_failed';
  const showNoWifiWarning = lanProbeError === 'no_lan_ip' || (!controlUrlHttp && !allControlUrls.length);

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}`}
      role="status"
      aria-label={controlLabel ? `Driver control ${controlLabel}` : 'Driver pairing'}
    >
      <div className="driver-pairing-banner-body">
        {joinUrl && code && (
          <div className="driver-pairing-qr-wrap">
            <DriverPairingQr value={joinUrl} size={qrSize} />
            {!compact && (
              <span className="driver-pairing-qr-caption">Scan with phone camera</span>
            )}
          </div>
        )}
        <div className="driver-pairing-banner-text">
          {plate && <div className="driver-pairing-plate">{plate}</div>}
          {code && (
            <div className="driver-pairing-code-row">
              <span className="driver-pairing-label">Pair code</span>
              <strong className="driver-pairing-code">{code}</strong>
            </div>
          )}
          {!compact && controlLabel && (
            <div className="driver-pairing-lan-row">
              <span className="driver-pairing-label">Control URL</span>
              <strong className="driver-pairing-lan">{controlLabel}</strong>
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <p className="driver-pairing-hint">
          Phone on <strong>same Wi‑Fi as this PC</strong>. Scan the QR with the phone <strong>camera</strong>{' '}
          app — it opens the driver app. Admin gives the pairing code separately. Use{' '}
          <strong>http://</strong>, not https.
        </p>
      )}
      {showNoWifiWarning && !compact && (
        <p className="driver-pairing-firewall-warn">
          <strong>No Wi‑Fi IP found</strong> — connect this PC to the bus router or phone hotspot, then
          restart the app.
        </p>
      )}
      {showBlockedWarning && !showNoWifiWarning && !compact && (
        <p className="driver-pairing-firewall-warn">
          <strong>Phones may be blocked</strong> — right-click <strong>allow-firewall.bat</strong> in the
          app folder → Run as administrator, then restart. Or run <strong>Install-AdKerala.bat</strong>{' '}
          once.
        </p>
      )}
      {allControlUrls.length > 1 && !compact && (
        <p className="driver-pairing-hint">
          If the URL above fails, try:{' '}
          {allControlUrls.map((u, i) => (
            <span key={u.ip}>
              {i > 0 ? ' · ' : ''}
              <strong>{u.controlUrl}</strong>
              {u.name ? ` (${u.name})` : ''}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
