/** URL encoded in the bus display QR — opens /control with pair code pre-filled. */
export function buildDriverJoinUrl(controlUrlHttp, pairingCode) {
  if (!controlUrlHttp) return null;
  try {
    const url = new URL(controlUrlHttp);
    const code = String(pairingCode ?? '')
      .replace(/\D/g, '')
      .slice(0, 4);
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
