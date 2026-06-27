import { useNetworkUrls } from '../hooks/useNetworkUrls';

export default function DriverConnectBanner() {
  const network = useNetworkUrls();
  const controlUrl = network?.controlUrlHttps ?? network?.controlUrl ?? null;
  const controlUrlHttp = network?.controlUrlHttp ?? null;
  const displayUrl = network?.displayUrl ?? null;
  const httpsEnabled = Boolean(network?.httpsEnabled);

  if (!controlUrl) return null;

  return (
    <div className="driver-connect-banner" role="status">
      {displayUrl && (
        <p>
          <strong>Bus display:</strong>{' '}
          <code>{displayUrl}</code>
        </p>
      )}
      <p>
        <strong>Driver phone:</strong> open{' '}
        <a href={controlUrl} className="driver-connect-link">
          {controlUrl}
        </a>
        {httpsEnabled ? ' (HTTPS — required for GPS)' : ''} on the same Wi‑Fi.
      </p>
      {httpsEnabled && controlUrlHttp && controlUrlHttp !== controlUrl && (
        <p className="driver-connect-sub">
          HTTP fallback: <code>{controlUrlHttp}</code> (GPS may not work on iPhone)
        </p>
      )}
    </div>
  );
}
