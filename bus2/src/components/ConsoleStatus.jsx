/** Console USB status — read-only on driver phone and passenger display. */
export default function ConsoleStatus({ serialRuntime = null, compact = false }) {
  const connected = Boolean(serialRuntime?.isConnected);
  const waiting = serialRuntime?.status === 'waiting' || serialRuntime?.status === 'connecting';
  const label = connected
    ? 'Console connected'
    : waiting
      ? 'Console — plug in USB cable'
      : 'Console disconnected';

  return (
    <div
      className={`console-status${compact ? ' console-status--compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={`console-status-dot ${connected ? 'on' : ''}`} aria-hidden />
      <span className="console-status-label">{label}</span>
    </div>
  );
}
