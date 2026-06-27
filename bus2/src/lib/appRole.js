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
