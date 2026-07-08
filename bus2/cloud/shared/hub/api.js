import { isLanOrigin } from './lan.js';
import {
  getHubOrigin,
  getHubToken,
  loadHubControlUrl,
} from './persist.js';

/** True when this page is served from the bus PC on the local network. */
export function isOnBusLanOrigin(origin = typeof window !== 'undefined' ? window.location.origin : '') {
  return isLanOrigin(origin);
}

/** Bus PC operator UI on loopback — drive works without hub pair. Driver phones use LAN IP + hub token. */
export function isBusPcLocalOrigin() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}

export function getHubApiBase() {
  // isOnBusLanOrigin() already defaults to '' when window is undefined (see its own default
  // param above) and safely returns false in that case — no separate guard needed here, and
  // removing it lets this run against a real HTTP server in Node tests, not just a browser.
  if (isOnBusLanOrigin()) return '';
  return getHubOrigin() || '';
}

export function hubApiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = getHubApiBase();
  return base ? `${base}${normalized}` : normalized;
}

// Plain fetch() has no built-in timeout — if the bus PC is unreachable in a way that doesn't
// produce an immediate TCP reset (a flaky router silently dropping packets, a captive portal,
// a firewall dropping instead of rejecting), a pair/ping/state/drive request can hang for tens
// of seconds or longer with the UI just spinning. Cap every hub request so a driver always sees
// a fast, actionable "lost connection" instead of an indefinite freeze — matches the 4s timeout
// server/networkInfo.js's own LAN probe already uses, with headroom for slower mobile networks.
export const HUB_FETCH_TIMEOUT_MS = 6000;

export function hubTimeoutSignal(ms = HUB_FETCH_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Fetch bus PC hub APIs — attaches session token when saved, times out instead of hanging. */
export function hubFetch(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  const token = getHubToken();
  if (token) headers['X-Hub-Token'] = token;
  return fetch(hubApiUrl(path), {
    ...options,
    headers,
    signal: options.signal ?? hubTimeoutSignal(),
  });
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
