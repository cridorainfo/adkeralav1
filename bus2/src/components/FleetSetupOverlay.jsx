import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_NAME } from '../lib/brand';

const POLL_MS = 3000;

/**
 * First-time fleet claim only — blocks the display when this PC has no local content yet.
 * Once routes/ads/audio exist in db/, the PC runs as an offline hub even without cloud.
 * Driver phones always connect to this PC over LAN, never to the cloud server.
 */
export default function FleetSetupOverlay() {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState('Connecting…');
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
      const json = await res.json().catch(() => null);
      if (!json || typeof json !== 'object') {
        setStatus('Could not reach bus server.');
        return;
      }
      setConfig(json);

      // Hub can run offline with local db/ content — unless admin deleted this bus from fleet.
      const hideOverlay = Boolean(json.claimed) || (Boolean(json.hubReady) && !json.requireFleetClaim);
      if (hideOverlay) {
        stopPolling();
        return;
      }

      if (!json.cloudUrl) {
        setStatus('No internet — add routes locally or connect to claim this bus in the fleet portal.');
        return;
      }
      setStatus('Waiting for owner to claim this bus in the cloud portal (one-time setup).');
    } catch {
      setStatus('Could not reach bus server.');
    }
  }, [stopPolling]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    return stopPolling;
  }, [refresh, stopPolling]);

  // Claimed, or offline hub with local content (unless fleet re-claim is required after delete).
  if (!config) return null;
  const hideOverlay =
    Boolean(config.claimed) || (Boolean(config.hubReady) && !config.requireFleetClaim);
  if (hideOverlay) return null;

  const claimBase = config.publicUrl || config.cloudUrl;
  const claimUrl = claimBase
    ? `${claimBase}/admin/claim${config.fleetClaimCode ? `?code=${config.fleetClaimCode}` : ''}`
    : '';

  return (
    <div className="fleet-setup-overlay" role="dialog" aria-labelledby="fleet-setup-title">
      <div className="fleet-setup-card">
        <h1 id="fleet-setup-title">{APP_NAME} — Fleet setup</h1>
        <p className="fleet-setup-lead">
          {config.requireFleetClaim
            ? 'This bus was removed from the fleet. Enter the code below in the admin portal to claim it again.'
            : 'One-time setup: enter this code in the admin portal so this PC can download routes, ads, and audio. After that, the bus runs from local files — phones control it over Wi‑Fi even without internet.'}
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
