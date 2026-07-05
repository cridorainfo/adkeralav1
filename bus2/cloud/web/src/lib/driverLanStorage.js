import { parseControlUrlFromScan } from './driverPairing.js';

const LAST_CONTROL_KEY = 'adkerala_last_control_url';

export function saveLastControlUrl(url) {
  const value = String(url ?? '').trim();
  if (!value) return;
  try {
    localStorage.setItem(LAST_CONTROL_KEY, value);
  } catch {
    /* private mode */
  }
}

export function loadLastControlUrl() {
  try {
    const value = localStorage.getItem(LAST_CONTROL_KEY);
    if (!value) return null;
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!url.pathname.includes('/control')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function navigateToBusControl(rawOrUrl) {
  const lanUrl = parseControlUrlFromScan(rawOrUrl) || rawOrUrl;
  if (!lanUrl) return false;
  try {
    const url = new URL(lanUrl);
    if (!/^https?:$/i.test(url.protocol)) return false;
    if (!url.pathname.includes('/control')) return false;
    saveLastControlUrl(url.toString());
    window.location.href = url.toString();
    return true;
  } catch {
    return false;
  }
}
