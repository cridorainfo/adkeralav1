// Human-readable "how long ago" for a timestamp (epoch ms) — covers seconds through years, unlike
// GpsSyncStatus.jsx's own agoText() which only ever deals with a live GPS fix a few seconds/
// minutes old and has no hour/day/week granularity. Needed by ReleasesPanel's fleet table: a bus
// stuck since a botched silent-update relaunch (see AdKeralaPackageReplacedReceiver.java) can sit
// offline for days, and "outdated" alone doesn't tell an admin whether that's from 5 minutes ago
// or 5 days ago.
export function formatRelativeTime(at) {
  if (!at) return 'Never';
  const diffMs = Date.now() - at;
  if (diffMs < 0) return 'just now'; // clock skew — never show a negative age
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}
