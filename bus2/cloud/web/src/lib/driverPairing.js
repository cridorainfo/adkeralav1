/** Parse 4-digit pair code or plate from QR text / URLs. */
import { isPrivateLanHost } from '#hub/lan';
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

/** Extract bus control URL from scanned QR (LAN /control or cloud ?control=). */
export function parseControlFromScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const direct = parseControlUrlFromScan(text);
  if (direct) return direct;

  try {
    const url = new URL(text);
    const control =
      url.searchParams.get('control') ||
      url.searchParams.get('url') ||
      url.searchParams.get('bus') ||
      url.searchParams.get('controlUrl');
    if (control) {
      try {
        const parsed = new URL(control);
        if (/^https?:$/i.test(parsed.protocol) && isPrivateLanHost(parsed.hostname)) {
          if (!parsed.pathname.includes('/control')) {
            parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/control`;
          }
          parsed.search = '';
          parsed.hash = '';
          return parsed.toString();
        }
      } catch {
        /* relative control param — ignore */
      }
    }
  } catch {
    /* not a URL */
  }

  return null;
}

/** If the QR is a direct bus LAN /driver or /control link, return the control URL. */
export function parseControlUrlFromScan(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!isPrivateLanHost(url.hostname)) return null;
    if (url.pathname.includes('/driver') || url.pathname.includes('/control')) {
      const control = new URL('/control', url.origin);
      return control.toString();
    }
    return null;
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
