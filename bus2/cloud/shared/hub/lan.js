/** RFC1918 / link-local / localhost — bus PC origins phones reach on Wi‑Fi. */
export function isVpnOnlyAddress(address) {
  const parts = String(address ?? '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  if (parts[0] === 10 && parts[1] === 255) return true;
  return false;
}

export function isPrivateLanHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local')) return true;
  if (isVpnOnlyAddress(host)) return false;
  if (host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host.startsWith('169.254.')) return true;
  return false;
}

/** Host phones can reach on bus Wi‑Fi — excludes 10.x (usually VPN; use 192.168 hotspot instead). */
export function isPhoneReachableHost(hostname) {
  if (!isPrivateLanHost(hostname)) return false;
  const parts = String(hostname ?? '').split('.').map(Number);
  if (parts.length === 4 && parts[0] === 10) return false;
  return true;
}

/** True when this page is served from the bus PC on the local network. */
export function isLanOrigin(origin = typeof window !== 'undefined' ? window.location.origin : '') {
  try {
    const url = new URL(origin);
    const { hostname, protocol } = url;
    if (protocol === 'capacitor:' || protocol === 'ionic:') return false;
    if (!/^https?:$/i.test(protocol)) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (protocol === 'https:' && (url.port === '' || url.port === '443')) return false;
      return true;
    }
    return isPrivateLanHost(hostname);
  } catch {
    return false;
  }
}
