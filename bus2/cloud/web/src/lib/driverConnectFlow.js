import {
  clearDriverBusSetup,
  loadBusControlUrl,
  loadPairingCode,
  normalizeControlUrl,
  saveBusControlUrl,
  savePairingCode,
} from './driverLanStorage.js';

const TOKEN_KEY = 'adkerala-driver-token';
const BUS_KEY = 'adkerala-driver-bus';
const PLATE_KEY = 'adkerala-driver-plate';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function getBusOriginFromControlUrl(controlUrl) {
  const normalized = normalizeControlUrl(controlUrl);
  if (!normalized) return null;
  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
}

function getStoredDriverToken() {
  const token = read(TOKEN_KEY);
  const bus = read(BUS_KEY);
  if (!token || !bus) return null;
  return token;
}

function saveDriverCredentials({ token, plate, busOrigin }) {
  write(TOKEN_KEY, token);
  write(BUS_KEY, busOrigin);
  if (plate) write(PLATE_KEY, plate);
}

function clearDriverCredentials() {
  write(TOKEN_KEY, null);
  write(BUS_KEY, null);
  write(PLATE_KEY, null);
}

export async function connectToBus(controlUrl, pairingCode) {
  const normalized = normalizeControlUrl(controlUrl);
  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (!normalized || code.length !== 4) {
    return { ok: false, error: 'Enter the 4-digit pairing code from admin' };
  }

  const origin = getBusOriginFromControlUrl(normalized);
  if (!origin) return { ok: false, error: 'Invalid bus address' };

  try {
    const res = await fetch(`${origin}/api/driver/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: code }),
    });
    const json = await res.json();
    if (!json.ok) {
      return { ok: false, error: json.error ?? 'Wrong pairing code — check with admin' };
    }

    saveBusControlUrl(normalized);
    savePairingCode(code);
    saveDriverCredentials({ token: json.token, plate: json.plate ?? '', busOrigin: origin });

    return { ok: true, controlUrl: normalized, plate: json.plate ?? '' };
  } catch {
    return { ok: false, error: 'Could not reach bus — join the same Wi‑Fi as the display PC' };
  }
}

export async function tryStoredAutoConnect() {
  const controlUrl = loadBusControlUrl();
  if (!controlUrl) return { ok: false, reason: 'no-url' };

  const origin = getBusOriginFromControlUrl(controlUrl);
  const token = getStoredDriverToken();
  const savedOrigin = read(BUS_KEY);

  if (token && savedOrigin && origin && savedOrigin === origin) {
    try {
      const res = await fetch(`${origin}/api/driver/unlock-status`, {
        headers: { 'X-Driver-Token': token },
      });
      const json = await res.json();
      if (json.unlocked) {
        return { ok: true, controlUrl };
      }
      clearDriverCredentials();
    } catch {
      clearDriverCredentials();
    }
  }

  const code = loadPairingCode();
  if (!code) return { ok: false, reason: 'need-code', controlUrl };

  const result = await connectToBus(controlUrl, code);
  if (result.ok) return result;
  return { ok: false, reason: 'connect-failed', error: result.error, controlUrl };
}

export function goToControl(controlUrl) {
  const url = normalizeControlUrl(controlUrl) || loadBusControlUrl();
  if (!url) return false;
  window.location.href = url;
  return true;
}

export function disconnectFromBus() {
  const origin = read(BUS_KEY);
  const token = getStoredDriverToken();
  if (origin && token) {
    fetch(`${origin}/api/driver/disconnect`, {
      method: 'POST',
      headers: { 'X-Driver-Token': token },
    }).catch(() => {});
  }
  clearDriverCredentials();
  clearDriverBusSetup();
}
