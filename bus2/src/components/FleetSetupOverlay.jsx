import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../lib/brand';

const POLL_MS = 3000;

export default function FleetSetupOverlay() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('Connecting…');
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/cloud/config');
      const json = await res.json();
      setConfig(json);

      if (json.claimed) {
        setDismissed(true);
        return;
      }

      setDismissed(false);

      if (!json.cloudUrl) {
        setStatus('Connecting to cloud… restart the app if this persists.');
        return;
      }
      setStatus('Waiting for owner to claim this bus in the cloud portal.');
    } catch {
      setStatus('Could not reach bus server.');
    }
  }, [stopPolling]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    return stopPolling;
  }, [refresh, stopPolling]);

  if (dismissed || config?.claimed) return null;

  if (config === null) {
    return (
      <div className="fleet-setup-overlay" role="dialog" aria-labelledby="fleet-setup-title">
        <div className="fleet-setup-card">
          <h1 id="fleet-setup-title">{APP_NAME} — Fleet setup</h1>
          <p className="fleet-setup-status" role="status">{status}</p>
        </div>
      </div>
    );
  }

  const claimBase = config.publicUrl || config.cloudUrl;
  const claimUrl = claimBase
    ? `${claimBase}/admin/claim${config.fleetClaimCode ? `?code=${config.fleetClaimCode}` : ''}`
    : '';

  return (
    <div className="fleet-setup-overlay" role="dialog" aria-labelledby="fleet-setup-title">
      <div className="fleet-setup-card">
        <h1 id="fleet-setup-title">{APP_NAME} — Fleet setup</h1>
        <p className="fleet-setup-lead">
          Enter this code in the admin portal to link this PC to your fleet.
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
