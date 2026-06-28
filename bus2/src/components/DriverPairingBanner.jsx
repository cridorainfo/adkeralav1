import { useNetworkUrls } from '../hooks/useNetworkUrls';
import { buildDriverJoinUrl } from '../lib/driverJoinUrl';
import DriverPairingQr from './DriverPairingQr';

/** Passenger display overlay — plate, pairing code, and LAN URL for driver phone. */
export default function DriverPairingBanner({ busProfile, driverLink, compact = false }) {
  const network = useNetworkUrls();
  const plate = busProfile?.plateDisplay || busProfile?.plate || '';
  const code = busProfile?.pairingCode ?? '';
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const lanIp = network?.primaryIp ?? network?.lan?.[0]?.address ?? null;
  const controlPort = network?.port ?? 5174;
  const firewallBlocked = network?.firewallOk === false;
  const lanReachable = network?.lanReachable;
  const altUrls = (network?.controlUrls ?? []).filter(
    (u) => u.controlUrl && u.controlUrl !== controlUrlHttp
  );

  if (driverLink?.driverId) {
    return (
      <div className="driver-pairing-badge driver-pairing-badge--linked" role="status">
        Driver connected
        {controlUrlHttp && !compact && (
          <span className="driver-pairing-lan">
            {' '}
            · {controlUrlHttp.replace(/^https?:\/\//, '')}
          </span>
        )}
      </div>
    );
  }

  if (!code && !controlUrlHttp && !lanIp) return null;

  const controlLabel = controlUrlHttp
    ? controlUrlHttp
    : lanIp
      ? `http://${lanIp}:${controlPort}/control`
      : '';

  const joinUrl = buildDriverJoinUrl(controlUrlHttp || controlLabel, code);
  const qrSize = compact ? 88 : 132;

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}`}
      role="status"
      aria-label={`Driver control ${controlLabel}`}
    >
      <div className="driver-pairing-banner-body">
        {joinUrl && code && (
          <div className="driver-pairing-qr-wrap">
            <DriverPairingQr value={joinUrl} size={qrSize} />
            {!compact && <span className="driver-pairing-qr-caption">Scan phone</span>}
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
              <span className="driver-pairing-label">Or type URL</span>
              <strong className="driver-pairing-lan">{controlLabel}</strong>
            </div>
          )}
        </div>
      </div>
      {!compact && (
        <p className="driver-pairing-hint">
          Same Wi‑Fi — scan QR or open URL, then enter <strong>admin OTP</strong> from the fleet dashboard.
        </p>
      )}
      {lanReachable === false && !compact && (
        <p className="driver-pairing-firewall-warn">
          <strong>Phones blocked</strong> — Windows Firewall is stopping Wi‑Fi access (127.0.0.1 works
          only on this PC). Right-click <strong>allow-firewall.bat</strong> → Run as administrator, then
          restart the app.
        </p>
      )}
      {firewallBlocked && lanReachable !== false && !compact && (
        <p className="driver-pairing-firewall-warn">
          Firewall may block phones — run <strong>allow-firewall.bat</strong> as Administrator in the app
          folder.
        </p>
      )}
      {altUrls.length > 0 && !compact && (
        <p className="driver-pairing-hint">
          If that IP fails, try:{' '}
          {altUrls.map((u) => (
            <strong key={u.ip}> {u.controlUrl}</strong>
          ))}
        </p>
      )}
    </div>
  );
}
