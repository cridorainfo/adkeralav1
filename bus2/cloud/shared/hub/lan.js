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
  // 10.x is usually a VPN range and 10.255.x specifically is rejected above via
  // isVpnOnlyAddress, but some bus PCs' real router/hotspot genuinely hands out other 10.x
  // addresses phones CAN reach. server/networkInfo.js's own tiering already treats other 10.x
  // as a legitimate (if deprioritized) fallback it still actively probes — this used to
  // contradict that by blanket-rejecting all 10.x here, silently breaking pairing on those
  // networks even when the server had already confirmed the address worked.
  if (/^10\./.test(host)) return true;
  return false;
}

/** Host phones can reach on bus Wi‑Fi. See isPrivateLanHost for the 10.x/VPN distinction. */
export function isPhoneReachableHost(hostname) {
  return isPrivateLanHost(hostname);
}

/**
 * Canonical 4-digit pairing-code extraction from a URL search string — checks `code`, `pair`,
 * and `c` consistently. This used to be reimplemented separately in driverJoinUrl.js,
 * driverConnectBoot.js, and twice in driverPairing.js, and they'd already drifted (only one
 * of them checked `c`). Everything that reads a pairing code out of a URL should call this.
 */
export function parsePairCodeFromSearch(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('code') || params.get('pair') || params.get('c') || '';
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  return digits.length === 4 ? digits : '';
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
