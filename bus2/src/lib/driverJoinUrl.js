import { isPrivateLanHost } from '#hub/lan';

/** QR on bus display — opens driver panel on the bus PC LAN (same Wi‑Fi origin). */
export function buildDriverJoinUrl(controlUrlHttp) {
  if (!controlUrlHttp) return null;

  try {
    const control = new URL(controlUrlHttp);
    if (!/^https?:$/i.test(control.protocol)) return null;
    if (!isPrivateLanHost(control.hostname)) return null;
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

/**
 * QR value for passenger display — cloud PWA link with embedded bus control URL.
 * Falls back to cloud /driver alone when office/VPN blocks a phone-reachable LAN IP.
 */
export function buildDriverQrUrl({ controlUrlHttp, cloudDriverUrl }) {
  if (cloudDriverUrl) {
    try {
      const cloud = new URL(cloudDriverUrl);
      if (controlUrlHttp) {
        try {
          const control = new URL(controlUrlHttp);
          if (isPrivateLanHost(control.hostname)) {
            cloud.searchParams.set('control', controlUrlHttp);
          }
        } catch {
          /* ignore invalid control URL */
        }
      }
      return cloud.toString();
    } catch {
      /* fall through */
    }
  }
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
