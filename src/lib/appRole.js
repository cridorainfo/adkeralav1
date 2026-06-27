/** App role from URL path — control (driver phone) vs display (bus PC). */
export function getAppRole(pathname = '') {
  if (pathname.startsWith('/display')) return 'display';
  if (pathname.startsWith('/control')) return 'control';
  return 'home';
}

export function isLaunchedByRunScript() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autofs') === '1';
}
