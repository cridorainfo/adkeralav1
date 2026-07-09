import { useKioskUpdateStatus } from '../hooks/useKioskUpdateStatus';

/** Minimal update status line below the logo — replaces a banner-covering overlay. */
export default function DisplayUpdateStatusText() {
  const status = useKioskUpdateStatus();

  if (!status?.visible) return null;

  let text = 'Software update…';
  if (status.phase === 'downloading') {
    text = status.percent != null ? `Updating… ${status.percent}%` : 'Updating…';
  } else if (status.phase === 'downloaded') {
    const sec = status.restartInSec ?? 0;
    text = sec > 0 ? `Update ready — restarting in ${sec}s` : 'Installing update…';
  } else if (status.phase === 'installing') {
    text = 'Installing update…';
  }

  return (
    <div className="display-update-status-text" role="status" aria-live="polite">
      {text}
    </div>
  );
}
