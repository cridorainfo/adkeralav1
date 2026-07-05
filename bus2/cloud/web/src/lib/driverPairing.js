/** Parse 4-digit pair code or plate from QR text / URLs. */
export function parsePairCodeFromScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';

  try {
    const url = new URL(text);
    const fromQuery =
      url.searchParams.get('code') ||
      url.searchParams.get('pair') ||
      url.searchParams.get('c') ||
      '';
    const digits = fromQuery.replace(/\D/g, '').slice(0, 4);
    if (digits.length === 4) return digits;
  } catch {
    /* not a URL */
  }

  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length === 4) return digitsOnly;
  if (digitsOnly.length > 4 && digitsOnly.length <= 6) return digitsOnly.slice(0, 4);

  return text.replace(/\s/g, '').toUpperCase();
}

/** If the QR is a direct bus LAN /control link, return it for immediate navigation. */
export function parseControlUrlFromScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!/\/control\/?$/i.test(url.pathname) && !url.pathname.includes('/control')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readPairCodeFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const raw = params.get('code') || params.get('pair') || '';
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length === 4) return digits;
  return '';
}
