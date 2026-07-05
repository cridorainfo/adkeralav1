import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverJoinUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display — QR to link driver phone, or compact corner badge when trip is running. */
export default function DriverPairingBanner({
  busProfile,
  connectedDeviceCount = 0,
  compact = false,
  fullscreen = false,
}) {
  const network = useNetworkUrls();
  const plate = busProfile?.plateDisplay || busProfile?.plate || '';
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

  const hasNetwork = Boolean(controlUrlHttp || lanIp || allControlUrls.length);
  if (!hasNetwork && !fullscreen) return null;

  const controlLabel =
    controlUrlHttp || (lanIp ? `http://${lanIp}:${controlPort}/control` : '');

  const joinUrl = buildDriverJoinUrl(controlUrlHttp || controlLabel);
  const qrSize = fullscreen ? 220 : compact ? 88 : 132;
  const showBlockedWarning = lanReachable === false || firewallBlocked || lanProbeError === 'probe_failed';
  const showNoWifiWarning = lanProbeError === 'no_lan_ip' || (!controlUrlHttp && !allControlUrls.length);
  const showDetails = fullscreen || !compact;

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}${fullscreen ? ' driver-pairing-screen' : ''}`}
      role="status"
      aria-label={controlLabel ? `Driver control ${controlLabel}` : 'Driver pairing'}
    >
      {fullscreen && (
        <h2 className="driver-pairing-screen-title">Connect driver phone</h2>
      )}
      <div className="driver-pairing-banner-body">
        {joinUrl && (
          <div className="driver-pairing-qr-wrap">
            <DriverPairingQr value={joinUrl} size={qrSize} />
            {showDetails && (
              <span className="driver-pairing-qr-caption">Scan with phone camera</span>
            )}
          </div>
        )}
        <div className="driver-pairing-banner-text">
          {plate && <div className="driver-pairing-plate">{plate}</div>}
          {showDetails && controlLabel && !fullscreen && (
            <div className="driver-pairing-lan-row">
              <span className="driver-pairing-label">Control URL</span>
              <strong className="driver-pairing-lan">{controlLabel}</strong>
            </div>
          )}
        </div>
      </div>
      {showDetails && (
        <p className="driver-pairing-hint">
          {fullscreen ? (
            <>
              Same Wi‑Fi as this PC. Scan the QR with the phone <strong>camera</strong> — then enter the
              admin pairing code on the driver app. Route and trip start after the driver connects.
            </>
          ) : (
            <>
              Phone on <strong>same Wi‑Fi as this PC</strong>. Scan the QR with the phone <strong>camera</strong>{' '}
              app — it saves the bus address. Admin gives the pairing code on the driver phone. Use{' '}
              <strong>http://</strong>, not https.
            </>
          )}
        </p>
      )}
      {showNoWifiWarning && showDetails && (
        <p className="driver-pairing-firewall-warn">
          <strong>No Wi‑Fi IP found</strong> — connect this PC to the bus router or phone hotspot, then
          restart the app.
        </p>
      )}
      {showBlockedWarning && !showNoWifiWarning && showDetails && (
        <p className="driver-pairing-firewall-warn">
          <strong>Phones may be blocked</strong> — right-click <strong>allow-firewall.bat</strong> in the
          app folder → Run as administrator, then restart. Or run <strong>Install-AdKerala.bat</strong>{' '}
          once.
        </p>
      )}
      {allControlUrls.length > 1 && showDetails && !fullscreen && (
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
