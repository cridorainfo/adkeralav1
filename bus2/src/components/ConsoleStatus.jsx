/** Console USB status — read-only on driver phone (USB stays on bus PC). */
export default function ConsoleStatus({ serialRuntime = null, compact = false }) {
  const connected = Boolean(serialRuntime?.isConnected);
  const label = connected ? 'Console connected' : 'Console disconnected';

  return (
    <div
      className={`console-status${compact ? ' console-status--compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={`console-status-dot ${connected ? 'on' : 'off'}`} aria-hidden />
      <span className="console-status-label">{label}</span>
      {!compact && connected && serialRuntime?.portLabel && (
        <span className="console-status-port">{serialRuntime.portLabel}</span>
      )}
    </div>
  );
}
