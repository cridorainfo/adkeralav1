/** QR on bus display — opens cloud driver PWA with LAN control URL (no pairing code in QR). */
export function buildDriverJoinUrl(controlUrlHttp, driverPwaBaseUrl = null) {
  if (!controlUrlHttp) return null;

  try {
    const control = new URL(controlUrlHttp);
    if (!control.pathname.includes('/control')) {
      control.pathname = `${control.pathname.replace(/\/$/, '')}/control`;
    }
    control.search = '';
    control.hash = '';

    let driver;
    if (driverPwaBaseUrl) {
      driver = new URL(driverPwaBaseUrl);
      if (!driver.pathname.endsWith('/driver')) {
        driver.pathname = `${driver.pathname.replace(/\/$/, '')}/driver`;
      }
    } else {
      driver = new URL('/driver', control.origin);
    }

    driver.searchParams.set('control', control.toString());
    return driver.toString();
  } catch {
    return null;
  }
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
