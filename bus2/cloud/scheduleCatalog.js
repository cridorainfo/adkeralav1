/** Normalize schedule (entertainment playlist) items for cloud catalog storage — same shape of
 * helper as cloud/adsCatalog.js, deliberately mirrored so schedule media round-trips through
 * the same relative-path conventions ads already use. */
import { mediaUrlToRelPath } from './adsCatalog.js';

export function normalizeScheduleItem(item, index = 0) {
  if (!item?.id) return null;
  const mediaFile = item.mediaFile ?? mediaUrlToRelPath(item.mediaUrl) ?? null;
  if (!mediaFile) return null;
  return {
    id: item.id,
    mediaFile,
    kind: item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : 'video',
    order: Number.isFinite(Number(item.order)) ? Number(item.order) : index,
    // null/undefined -> play the video's own natural length; images need an explicit duration
    // to know when to advance (see src/components/SchedulePlayer.jsx).
    durationSec: Number.isFinite(Number(item.durationSec)) ? Number(item.durationSec) : null,
  };
}

export function normalizeScheduleItems(list) {
  return (list ?? [])
    .map((item, i) => normalizeScheduleItem(item, i))
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);
}

export function collectScheduleMediaPaths(items = []) {
  const paths = new Set();
  for (const item of items) {
    if (item?.mediaFile) paths.add(item.mediaFile);
  }
  return [...paths];
}

/** Media paths removed from a schedule update (safe to delete when no longer referenced
 * anywhere else — see server/cloudCommands.js's collectScheduleMediaFromState for the
 * device-side equivalent that protects still-in-use files from GC). */
export function collectRemovedScheduleMediaPaths(prevItems = [], nextItems = []) {
  const prev = new Set(collectScheduleMediaPaths(prevItems));
  const next = new Set(collectScheduleMediaPaths(nextItems));
  return [...prev].filter((p) => !next.has(p));
}
