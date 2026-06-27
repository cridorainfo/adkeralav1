/** In-app APK update helper for Capacitor driver app. */
export async function downloadAndInstallApk(downloadUrl) {
  if (!downloadUrl) return { ok: false, error: 'No download URL' };

  if (window.Capacitor?.isNativePlatform?.()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: downloadUrl });
      return { ok: true, mode: 'browser' };
    } catch {
      window.location.href = downloadUrl;
      return { ok: true, mode: 'redirect' };
    }
  }

  window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  return { ok: true, mode: 'web' };
}
