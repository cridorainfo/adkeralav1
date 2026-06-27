import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../lib/brand';

const POLL_MS = 3000;

export default function FleetSetupOverlay() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('Connecting…');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cloud/config');
      const json = await res.json();
      setConfig(json);
      if (json.claimed) {
        setStatus('Fleet linked — starting display…');
        window.location.reload();
        return;
      }
      if (!json.cloudUrl) {
        setStatus('Cloud URL not configured. Set ADKERALA_CLOUD_URL or rebuild with VITE_CLOUD_URL.');
        return;
      }
      setStatus('Waiting for owner to claim this bus in the cloud portal.');
    } catch {
      setStatus('Could not reach bus server.');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!config || config.claimed) return null;

  const claimUrl = config.cloudUrl
    ? `${config.cloudUrl}/owner/claim${config.fleetClaimCode ? `?code=${config.fleetClaimCode}` : ''}`
    : '';

  return (
    <div className="fleet-setup-overlay" role="dialog" aria-labelledby="fleet-setup-title">
      <div className="fleet-setup-card">
        <h1 id="fleet-setup-title">{APP_NAME} — Fleet setup</h1>
        <p className="fleet-setup-lead">
          Enter this code in the bus owner portal to link this PC to your fleet.
        </p>
        {config.fleetClaimCode && (
          <div className="fleet-setup-code" aria-label={`Fleet code ${config.fleetClaimCode}`}>
            {config.fleetClaimCode.split('').map((digit, i) => (
              <span key={i} className="fleet-setup-digit">
                {digit}
              </span>
            ))}
          </div>
        )}
        {claimUrl && (
          <p className="fleet-setup-url">
            Portal:{' '}
            <a href={claimUrl} target="_blank" rel="noopener noreferrer">
              Claim bus
            </a>
          </p>
        )}
        <p className="fleet-setup-status" role="status">
          {status}
        </p>
        <p className="fleet-setup-hint">
          Device ID: <code>{config.installId?.slice(0, 8)}…</code>
        </p>
      </div>
    </div>
  );
}
