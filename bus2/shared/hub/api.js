import {
  getHubOrigin,
  getHubToken,
  loadHubControlUrl,
} from './persist.js';

/** True when this page is served from the bus PC on the local network. */
export function isOnBusLanOrigin(origin = typeof window !== 'undefined' ? window.location.origin : '') {
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

export function getHubApiBase() {
  if (typeof window === 'undefined') return '';
  if (isOnBusLanOrigin()) return '';
  return getHubOrigin() || '';
}

export function hubApiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = getHubApiBase();
  return base ? `${base}${normalized}` : normalized;
}

/** Fetch bus PC hub APIs — attaches session token when saved. */
export function hubFetch(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const token = getHubToken();
  if (token) headers['X-Hub-Token'] = token;
  return fetch(hubApiUrl(path), { ...options, headers });
}

export function redirectToSavedHubControl() {
  const last = loadHubControlUrl();
  if (!last) return false;
  try {
    window.location.replace(last);
    return true;
  } catch {
    return false;
  }
}
