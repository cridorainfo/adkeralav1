import { useEffect, useState } from 'react';

function agoText(at) {
  if (!at) return null;
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return `${mins}m ago`;
}

function durationText(ms) {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

/** Debug readout for the GPS-detection test phase — raw fix + cloud sync state, no map. */
export default function GpsSyncStatus({
  location,
  permission,
  onEnableGps,
  linked,
  linkError,
  syncError,
  lastSyncedAt,
  pushCount,
  trackingMode,
  reliability,
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const hasFix = location?.lat != null && location?.lng != null && !location?.error;

  return (
    <div className="gps-status-card" role="status">
      {permission !== 'granted' && (
        <div className={`gps-permission-banner compact${permission === 'denied' ? ' denied' : ''}`} role="alert">
          <strong>{permission === 'denied' ? 'Location blocked' : 'Location required'}</strong>
          <p>
            {permission === 'denied'
              ? 'Open phone Settings → Site settings → Location → Allow for this site.'
              : 'AdKerala needs your location for live fleet tracking. Tap below to allow it.'}
          </p>
          {permission !== 'denied' && onEnableGps && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onEnableGps}>
              Allow location access
            </button>
          )}
        </div>
      )}
      {permission === 'granted' && (
        <div className={`gps-keep-open-nudge${trackingMode === 'background' ? ' warn' : ''}`}>
          {trackingMode === 'background'
            ? '⚠ App is backgrounded — GPS may pause. Reopen and keep the screen on while driving.'
            : 'Keep this screen unlocked and the app open while driving for reliable tracking.'}
        </div>
      )}
      <div className="gps-status-row">
        <span>Phone GPS</span>
        <strong>
          {location?.error
            ? location.error
            : hasFix
              ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
              : 'Acquiring…'}
        </strong>
      </div>
      {hasFix && (
        <div className="gps-status-row">
          <span>Accuracy / fix age</span>
          <strong>
            {location.accuracy != null ? `±${Math.round(location.accuracy)}m` : '—'}
            {location.at ? ` · ${agoText(location.at)}` : ''}
          </strong>
        </div>
      )}
      <div className="gps-status-row">
        <span>Cloud link</span>
        <strong>{linked ? 'Linked' : linkError || 'Linking…'}</strong>
      </div>
      <div className="gps-status-row">
        <span>Last synced to server</span>
        <strong>
          {syncError && !lastSyncedAt
            ? syncError
            : lastSyncedAt
              ? `${agoText(lastSyncedAt)} (${pushCount} sent)`
              : linked
                ? 'Waiting for first fix…'
                : 'Not linked yet'}
        </strong>
      </div>
      {reliability && (
        <div className="gps-status-row">
          <span>Tracking gaps this session</span>
          <strong className={reliability.gapCount > 0 ? 'warn-text' : ''}>
            {reliability.gapCount > 0
              ? `${reliability.gapCount} gap${reliability.gapCount === 1 ? '' : 's'}, ${durationText(reliability.totalGapMs)} total (longest ${durationText(reliability.longestGapMs)})`
              : 'None yet'}
          </strong>
        </div>
      )}
    </div>
  );
}
