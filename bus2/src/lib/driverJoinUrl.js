/** URL encoded in the bus display QR — opens /control on this bus PC (LAN only). */
export function buildDriverJoinUrl(controlUrlHttp, pairingCode) {
  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);

  if (!controlUrlHttp) return null;

  try {
    const url = new URL(controlUrlHttp);
    if (code) url.searchParams.set('code', code);
    return url.toString();
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
