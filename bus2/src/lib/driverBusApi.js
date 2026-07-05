import { loadBusControlUrl } from './driverLanStorage.js';
import { getStoredDriverBusOrigin } from './driverCredentials.js';

/**
 * Driver phone ↔ bus PC control is always LAN-only.
 * The bus PC is the hub — phones log in to it with a pair code and control routes/trips locally.
 * Cloud/internet on the phone is never required for control.
 * Only the bus PC uses internet (when available) for fleet claim and downloading route/ad/audio updates.
 */

/** True when this page is served from the bus PC on the local network (or local dev). */
export function isOnBusLanOrigin(origin = window.location.origin) {
  try {
    const url = new URL(origin);
    const { hostname, protocol } = url;
    if (protocol === 'capacitor:' || protocol === 'ionic:') return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
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
  const saved = loadBusControlUrl();
  if (saved) {
    try {
      return new URL(saved).origin;
    } catch {
      /* fall through */
    }
  }
  return getStoredDriverBusOrigin() || '';
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

/** Redirect to saved bus control URL when opened from APK on the wrong origin. */
export function redirectToSavedBusControl() {
  const last = loadBusControlUrl();
  if (!last) return false;
  try {
    window.location.replace(last);
    return true;
  } catch {
    return false;
  }
}
