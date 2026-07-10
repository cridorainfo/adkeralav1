/** High-accuracy options (walking / navigation grade). */
export const HIGH_ACCURACY_GEO = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 45000,
};

export async function isNativePlatform() {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function normalizePermission(value) {
  if (value === 'granted' || value === 'limited') return 'granted';
  if (value === 'denied') return 'denied';
  return 'prompt';
}

export async function checkLocationPermission() {
  if (await isNativePlatform()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const perm = await Geolocation.checkPermissions();
    if (perm.location === 'granted' || perm.coarseLocation === 'granted') return 'granted';
    if (perm.location === 'denied' && perm.coarseLocation === 'denied') return 'denied';
    return 'prompt';
  }
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch {
    return 'unknown';
  }
}

/** Request location access — on native Android this also starts the foreground
 *  tracking service so GPS keeps reporting while the driver uses other apps. */
export async function requestLocationAccess() {
  if (await isNativePlatform()) {
    const { Capacitor } = await import('@capacitor/core');
    const { Geolocation } = await import('@capacitor/geolocation');

    let perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
      perm = await Geolocation.requestPermissions();
    }

    let state = normalizePermission(perm.location ?? perm.coarseLocation);
    if (state !== 'granted') return state;

    if (Capacitor.getPlatform() === 'android') {
      try {
        const { startAndroidTrackingService } = await import('./androidTrackingService.js');
        await startAndroidTrackingService();
      } catch {
        /* optional foreground service */
      }
    }

    return 'granted';
  }

  if (!navigator.geolocation) return 'denied';

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (err) => resolve(err?.code === 1 ? 'denied' : 'prompt'),
      HIGH_ACCURACY_GEO
    );
  });
}
