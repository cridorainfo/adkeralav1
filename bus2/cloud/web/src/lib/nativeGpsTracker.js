import { Capacitor, registerPlugin } from '@capacitor/core';

const GpsTracker = registerPlugin('GpsTracker');

/** True only inside the Android Capacitor app — the always-on native tracker
 *  doesn't exist on web/iOS, where the JS-driven watcher is used instead. */
export function isAndroidNative() {
  return Capacitor.getPlatform() === 'android' && Capacitor.isNativePlatform();
}

/** Starts the native foreground-service tracker. Survives the app being
 *  backgrounded, switched away from, closed, or the phone rebooting. */
export async function startNativeTracking({ driverId, cloudUrl }) {
  if (!isAndroidNative()) return;
  try {
    await GpsTracker.start({ driverId, cloudUrl });
  } catch {
    /* plugin unavailable (stale installed build) — silently no-op */
  }
}

export async function stopNativeTracking() {
  if (!isAndroidNative()) return;
  try {
    await GpsTracker.stop();
  } catch {
    /* ignore */
  }
}

/** { tracking, lastFixAt, lastSyncAt, lastError } or null off-Android. */
export async function getNativeTrackingStatus() {
  if (!isAndroidNative()) return null;
  try {
    return await GpsTracker.getStatus();
  } catch {
    return null;
  }
}
