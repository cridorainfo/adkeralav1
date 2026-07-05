import { loadBusControlUrl } from './driverLanStorage.js';

const TOKEN_KEY = 'adkerala-driver-token';

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
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

/** Fetch bus PC LAN APIs from the cloud driver PWA origin. */
export async function busFetch(path, options = {}) {
  const origin = getBusOrigin();
  if (!origin) throw new Error('No bus address saved');
  const headers = { ...(options.headers ?? {}) };
  const token = readToken();
  if (token) headers['X-Driver-Token'] = token;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${origin}${normalized}`, { ...options, headers });
}
