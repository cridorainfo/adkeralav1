import { useNetworkUrls } from '../hooks/useNetworkUrls';

/** Passenger display overlay — plate, pairing code, and LAN URL for driver phone. */
export default function DriverPairingBanner({ busProfile, driverLink, compact = false }) {
  const network = useNetworkUrls();
  const plate = busProfile?.plateDisplay || busProfile?.plate || '';
  const code = busProfile?.pairingCode ?? '';
  const controlUrlHttp = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const driverUrl = network?.driverUrl ?? null;
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

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}`}
      role="status"
      aria-label={`Driver control ${controlLabel}`}
    >
      {plate && <div className="driver-pairing-plate">{plate}</div>}
      {controlLabel && (
        <div className="driver-pairing-lan-row">
          <span className="driver-pairing-label">Driver phone — type exactly:</span>
          <strong className="driver-pairing-lan">{controlLabel}</strong>
        </div>
      )}
      {code && (
        <div className="driver-pairing-code-row">
          <span className="driver-pairing-label">Pair code</span>
          <strong className="driver-pairing-code">{code}</strong>
        </div>
      )}
      {!compact && (
        <p className="driver-pairing-hint">
          Same Wi‑Fi only. Copy the full URL including <strong>http://</strong> (not https).
          {driverUrl && (
            <>
              {' '}
              Pair: <strong>{driverUrl}</strong>
            </>
          )}
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
