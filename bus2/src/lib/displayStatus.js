/** Cloud sync interval is ~5s — treat as online if telemetry pushed recently. */
export const CLOUD_ONLINE_MS = Number(process.env.ADKERALA_CLOUD_ONLINE_MS ?? 45000);

export function isCloudOnline(lastCloudPushAt, now = Date.now()) {
  const at = Number(lastCloudPushAt ?? 0);
  if (!at) return false;
  return now - at <= CLOUD_ONLINE_MS;
}

export function isUpdateDownloading(updateStatus) {
  if (!updateStatus?.visible) return false;
  return updateStatus.phase === 'downloading';
}
