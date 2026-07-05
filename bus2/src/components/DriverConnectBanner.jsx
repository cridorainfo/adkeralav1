import { useNetworkUrls } from '../hooks/useNetworkUrls';

export default function DriverConnectBanner() {
  const network = useNetworkUrls();
  const controlUrl = network?.controlUrlHttp ?? network?.controlUrl ?? null;
  const controlUrlHttps = network?.controlUrlHttps ?? null;
  const driverUrl = network?.driverUrl ?? null;
  const displayUrl = network?.displayUrl ?? null;
  const httpsEnabled = Boolean(network?.httpsEnabled);
  const firewallBlocked = network?.firewallOk === false;

  if (!controlUrl) return null;

  return (
    <div className="driver-connect-banner" role="status">
      {displayUrl && (
        <p>
          <strong>Bus display:</strong> <code>{displayUrl}</code>
        </p>
      )}
      <p>
        <strong>Driver phone:</strong> open{' '}
        <a href={controlUrl} className="driver-connect-link">
          {controlUrl}
        </a>{' '}
        on the same Wi‑Fi (internet on phone or bus is fine — control stays on this PC; use{' '}
        <strong>http://</strong>, not https).
      </p>
      {driverUrl && (
        <p>
          <strong>Pair:</strong> <code>{driverUrl}</code>
        </p>
      )}
      {httpsEnabled && controlUrlHttps && (
        <p className="driver-connect-sub">
          HTTPS (GPS only): <code>{controlUrlHttps}</code> — accept certificate warning once.
        </p>
      )}
      {(firewallBlocked || network?.lanReachable === false) && (
        <p className="driver-connect-sub" style={{ color: '#b45309' }}>
          Run <strong>allow-firewall.bat</strong> as Administrator if the phone shows &quot;site can&apos;t be
          reached&quot;.
        </p>
      )}
    </div>
  );
}
