/** URL encoded in the bus display QR — opens /control with pair code pre-filled. */
export function buildDriverJoinUrl(controlUrlHttp, pairingCode, cloudDriverBase) {
  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);

  if (cloudDriverBase && code) {
    try {
      const cloud = new URL(String(cloudDriverBase).replace(/\/$/, '') + '/driver');
      cloud.searchParams.set('code', code);
      return cloud.toString();
    } catch {
      /* fall through */
    }
  }

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
