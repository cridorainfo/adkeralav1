import { loadLastControlUrl } from './driverLanStorage.js';

/**
 * Driver phone ↔ bus PC control is always LAN-only.
 * Internet on the phone or bus Wi‑Fi does not affect it.
 * Only the bus PC uses internet to sync routes, ads, and audio from the cloud.
 */

/** True when this page is served from the bus PC on the local network (or local dev). */
export function isOnBusLanOrigin(origin = window.location.origin) {
  try {
    const url = new URL(origin);
    const { hostname, protocol } = url;
    if (protocol === 'capacitor:' || protocol === 'ionic:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Capacitor native WebView uses https://localhost — not the bus PC.
      if (protocol === 'https:' && (url.port === '' || url.port === '443')) return false;
      return true;
    }
    if (/^192\.168\./.test(hostname)) return true;
    if (/^10\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    return false;
  } catch {
    return false;
  }
}

/** Base URL for bus PC API calls — empty string means same-origin (LAN page). */
export function getBusApiBase() {
  if (typeof window === 'undefined') return '';
  if (isOnBusLanOrigin()) return '';
  const last = loadLastControlUrl();
  if (!last) return '';
  try {
    return new URL(last).origin;
  } catch {
    return '';
  }
}

export function busApiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = getBusApiBase();
  return base ? `${base}${normalized}` : normalized;
}

/** Fetch bus PC APIs — never uses cloud; works with or without internet on phone/PC. */
export function busFetch(path, options) {
  return fetch(busApiUrl(path), options);
}

/** Redirect to saved bus control URL when opened from APK/PWA on the wrong origin. */
export function redirectToSavedBusControl(search = window.location.search) {
  const last = loadLastControlUrl();
  if (!last) return false;
  try {
    const url = new URL(last);
    const params = new URLSearchParams(search);
    const code = params.get('code') || params.get('pair');
    if (code) url.searchParams.set('code', code.replace(/\D/g, '').slice(0, 4));
    window.location.replace(url.toString());
    return true;
  } catch {
    return false;
  }
}
