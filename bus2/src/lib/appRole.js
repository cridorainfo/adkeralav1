/** App role from URL path — control (driver phone) vs display (bus PC). */
export function getAppRole(pathname = '') {
  if (pathname.startsWith('/display')) return 'display';
  if (pathname.startsWith('/control')) return 'control';
  return 'home';
}

export function isDisplayRole(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  return getAppRole(pathname) === 'display';
}

export function isControlRole(pathname = typeof window !== 'undefined' ? window.location.pathname : '') {
  return getAppRole(pathname) === 'control';
}

export function isLaunchedByRunScript() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autofs') === '1';
}

export function isKioskMode() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('kiosk') === '1';
}

/** Bus PC running /control — USB serial works here (127.0.0.1 / Electron), not on driver phones. */
export function isBusPcForSerial() {
  if (typeof window === 'undefined') return false;
  if (window.adKeralaKiosk?.kiosk || window.adKeralaKiosk?.busControl) return true;
  const params = new URLSearchParams(window.location.search);
  if (params.get('buspc') === '1') return true;
  const host = window.location.hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
}
