import { useNetworkUrls } from '../hooks/useNetworkUrls';

export default function DriverConnectBanner() {
  const network = useNetworkUrls();
  const controlUrl = network?.controlUrl ?? null;
  const displayUrl = network?.displayUrl ?? null;

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
        </a>{' '}
        on the same Wi‑Fi.
      </p>
    </div>
  );
}
