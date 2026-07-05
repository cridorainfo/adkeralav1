import { loadBusControlUrl } from './driverLanStorage.js';

const TOKEN_KEY = 'adkerala-driver-token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** True when this page is served from the bus PC on the local network. */
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

export function getBusOrigin() {
  const control = loadBusControlUrl();
  if (!control) return null;
  try {
    return new URL(control).origin;
  } catch {
    return null;
  }
}

/** Fetch bus PC LAN APIs — same-origin on bus Wi‑Fi, cross-origin only as fallback. */
export async function busFetch(path, options = {}) {
  const origin = getBusOrigin();
  if (!origin) throw new Error('No bus address saved');
  const headers = { ...(options.headers ?? {}) };
  const token = readToken();
  if (token) headers['X-Driver-Token'] = token;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${origin}${normalized}`, { ...options, headers });
}
