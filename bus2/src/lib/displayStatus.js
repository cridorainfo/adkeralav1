/** Cloud sync interval is ~5s — treat as online if telemetry pushed recently.
 * `process` isn't guaranteed to exist wherever this bundle actually runs (Electron kiosk vs
 * Android WebView vs a plain browser dev server all differ) — guard the lookup instead of
 * assuming it, so a context without a `process` global degrades to the default instead of
 * crashing the whole display screen at import time (real crash caught: ReferenceError: process
 * is not defined, in a plain-browser context). */
export const CLOUD_ONLINE_MS = Number(
  (typeof process !== 'undefined' ? process.env?.ADKERALA_CLOUD_ONLINE_MS : undefined) ?? 45000
);

export function isCloudOnline(lastCloudPushAt, now = Date.now()) {
  const at = Number(lastCloudPushAt ?? 0);
  if (!at) return false;
  return now - at <= CLOUD_ONLINE_MS;
}

export function isUpdateDownloading(updateStatus) {
  if (!updateStatus?.visible) return false;
  return updateStatus.phase === 'downloading';
}
