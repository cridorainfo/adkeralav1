import { persistDriverValue, removeDriverValues } from './driverPersistentStorage.js';

const LAST_CONTROL_KEY = 'adkerala_last_control_url';
const BUS_CONTROL_URL_KEY = 'adkerala_bus_control_url';
const PAIRING_CODE_KEY = 'adkerala_saved_pair_code';

export { hydrateDriverStorage } from './driverPersistentStorage.js';

/** Normalize to http://host:port/control without query params. */
export function normalizeControlUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (!url.pathname.includes('/control')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/control`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function saveBusControlUrl(raw) {
  const normalized = normalizeControlUrl(raw);
  if (!normalized) return null;
  persistDriverValue(BUS_CONTROL_URL_KEY, normalized);
  persistDriverValue(LAST_CONTROL_KEY, normalized);
  return normalized;
}

export function loadBusControlUrl() {
  try {
    const value =
      localStorage.getItem(BUS_CONTROL_URL_KEY) || localStorage.getItem(LAST_CONTROL_KEY);
    return normalizeControlUrl(value);
  } catch {
    return null;
  }
}

export function savePairingCode(code) {
  const digits = String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (digits.length !== 4) return;
  persistDriverValue(PAIRING_CODE_KEY, digits);
}

export function loadPairingCode() {
  try {
    const value = localStorage.getItem(PAIRING_CODE_KEY);
    if (!value) return null;
    const digits = value.replace(/\D/g, '').slice(0, 4);
    return digits.length === 4 ? digits : null;
  } catch {
    return null;
  }
}

/** Clear saved bus URL and pairing code (on disconnect — scan QR again). */
export function clearDriverBusSetup() {
  removeDriverValues([BUS_CONTROL_URL_KEY, LAST_CONTROL_KEY, PAIRING_CODE_KEY]);
}

/** @deprecated use saveBusControlUrl */
export function saveLastControlUrl(url) {
  saveBusControlUrl(url);
}

export function loadLastControlUrl() {
  return loadBusControlUrl();
}

export function clearLastControlUrl() {
  clearDriverBusSetup();
}

export function readBusControlFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const raw =
    params.get('control') || params.get('url') || params.get('bus') || params.get('controlUrl');
  return normalizeControlUrl(raw);
}
