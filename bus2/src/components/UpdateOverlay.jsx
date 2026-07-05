import { useKioskUpdateStatus } from '../hooks/useKioskUpdateStatus';

/** Shown on the bus display when a PC app update is downloading or about to restart. */
export default function UpdateOverlay() {
  const status = useKioskUpdateStatus();

  if (!status?.visible) return null;

  let message = 'Software update in progress…';
  if (status.phase === 'downloading') {
    message = status.version
      ? `Downloading update v${status.version}${status.percent != null ? ` (${status.percent}%)` : ''}…`
      : 'Downloading update…';
  } else if (status.phase === 'downloaded') {
    const sec = status.restartInSec ?? 0;
    message =
      sec > 0
        ? `Update v${status.version ?? ''} ready — restarting in ${sec}s`
        : `Installing update v${status.version ?? ''}…`;
  } else if (status.phase === 'installing') {
    message = 'Installing update — screen will restart…';
  }

  return (
    <div className="update-overlay" role="status" aria-live="polite">
      <div className="update-overlay__card">
        <strong>AdKerala update</strong>
        <p>{message}</p>
      </div>
    </div>
  );
}
