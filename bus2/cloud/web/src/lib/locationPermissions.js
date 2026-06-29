/** Browser/PWA only — cloud web is not a Capacitor native app. */

export const HIGH_ACCURACY_GEO = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 45000,
};

export async function isNativePlatform() {
  return false;
}

export async function checkLocationPermission() {
  if (!navigator.permissions?.query) return 'unknown';
  try {
    const result = await navigator.permissions.query({ name: 'geolocation' });
    return result.state;
  } catch {
    return 'unknown';
  }
}

export async function requestLocationAccess() {
  if (!navigator.geolocation) return 'denied';

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve('granted'),
      (err) => resolve(err?.code === 1 ? 'denied' : 'prompt'),
      HIGH_ACCURACY_GEO
    );
  });
}
