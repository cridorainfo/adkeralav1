/** Prompt driver to grant location — shown until GPS permission is granted. */
export default function GpsPermissionBanner({
  permission,
  onEnable,
  busy = false,
  compact = false,
}) {
  if (permission === 'granted') return null;

  const denied = permission === 'denied';
  const title = denied ? 'Location blocked' : 'Location required';
  const detail = denied
    ? 'Open phone Settings → Apps → AdKerala Driver → Permissions → Location → Allow all the time.'
    : 'AdKerala needs your location for live fleet tracking and GPS auto-stops. Tap below — choose Allow while using the app or Allow all the time.';

  return (
    <div className={`gps-permission-banner${denied ? ' denied' : ''}${compact ? ' compact' : ''}`} role="alert">
      <strong>{title}</strong>
      <p>{detail}</p>
      {!denied && onEnable && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={onEnable}>
          {busy ? 'Requesting…' : 'Allow location access'}
        </button>
      )}
    </div>
  );
}
