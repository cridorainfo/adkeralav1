const LAST_CONTROL_KEY = 'adkerala_last_control_url';

/** Last bus control URL this phone used (LAN only — never cloud). */
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

export function clearLastControlUrl() {
  try {
    localStorage.removeItem(LAST_CONTROL_KEY);
  } catch {
    /* ignore */
  }
}
