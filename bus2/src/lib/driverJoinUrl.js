import { isPhoneReachableHost } from '#hub/lan';

/** QR on bus display — opens driver panel on the bus PC LAN (same Wi‑Fi origin). */
export function buildDriverJoinUrl(controlUrlHttp) {
  if (!controlUrlHttp) return null;

  try {
    const control = new URL(controlUrlHttp);
    if (!/^https?:$/i.test(control.protocol)) return null;
    if (!isPhoneReachableHost(control.hostname)) return null;
    if (!control.pathname.includes('/control')) {
      control.pathname = `${control.pathname.replace(/\/$/, '')}/control`;
    }
    const driver = new URL('/driver', control.origin);
    driver.search = '';
    driver.hash = '';
    return driver.toString();
  } catch {
    return null;
  }
}

/** QR on bus display — local LAN URL the driver phone must open (no cloud, no pairing code). */
export function buildDriverQrUrl({ controlUrlHttp }) {
  return buildDriverJoinUrl(controlUrlHttp);
}

export function readPairingCodeFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('code') || params.get('pair') || '';
  return raw.replace(/\D/g, '').slice(0, 4);
}

/** Build /control URL on the current bus PC origin. */
export function controlUrlOnCurrentOrigin(code) {
  const digits = String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const url = new URL('/control', window.location.origin);
  if (digits.length === 4) url.searchParams.set('code', digits);
  return url.toString();
}
