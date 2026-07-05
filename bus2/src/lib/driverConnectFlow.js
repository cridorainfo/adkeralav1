import {
  clearDriverBusSetup,
  hydrateDriverStorage,
  loadBusControlUrl,
  loadPairingCode,
  normalizeControlUrl,
  saveBusControlUrl,
  savePairingCode,
} from './driverLanStorage';
import {
  clearDriverCredentials,
  clearDriverToken,
  getStoredDriverBusOrigin,
  getStoredDriverPlate,
  getStoredDriverToken,
  saveDriverCredentials,
} from './driverCredentials';

export function getBusOriginFromControlUrl(controlUrl) {
  const normalized = normalizeControlUrl(controlUrl);
  if (!normalized) return null;
  try {
    return new URL(normalized).origin;
  } catch {
    return null;
  }
}

function busOriginForFetch(controlUrl) {
  return getBusOriginFromControlUrl(controlUrl) || getStoredDriverBusOrigin();
}

async function fetchBusApi(controlUrl, path, options = {}) {
  const origin = busOriginForFetch(controlUrl);
  if (!origin) throw new Error('No bus address saved');
  return fetch(`${origin}${path.startsWith('/') ? path : `/${path}`}`, options);
}

/** POST /api/driver/connect on the saved bus PC. */
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
    const res = await fetchBusApi(normalized, '/api/driver/connect', {
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
    saveDriverCredentials({
      token: json.token,
      plate: json.plate ?? '',
      busOrigin: origin,
    });

    return { ok: true, controlUrl: normalized, plate: json.plate ?? '' };
  } catch {
    return { ok: false, error: 'Could not reach bus — join the same Wi‑Fi as the display PC' };
  }
}

/**
 * Keep driver session alive on LAN — reuse token, or reconnect with saved admin code.
 * Never clears saved URL / pairing code (only explicit disconnect does).
 */
export async function ensureDriverSession() {
  await hydrateDriverStorage();
  const controlUrl = loadBusControlUrl();
  if (!controlUrl) return { ok: false, reason: 'no-url' };

  const token = getStoredDriverToken();
  if (token) {
    try {
      const res = await fetchBusApi(controlUrl, '/api/driver/unlock-status', {
        headers: { 'X-Driver-Token': token },
      });
      const json = await res.json();
      if (json.unlocked) {
        return {
          ok: true,
          controlUrl,
          plate: json.plate ?? getStoredDriverPlate(),
        };
      }
      clearDriverToken();
    } catch {
      return { ok: false, reason: 'offline', controlUrl, keepTrying: true };
    }
  }

  const code = loadPairingCode();
  if (!code) return { ok: false, reason: 'need-code', controlUrl };

  const result = await connectToBus(controlUrl, code);
  if (result.ok) return { ...result, reason: 'reconnected' };
  return { ok: false, reason: 'connect-failed', error: result.error, controlUrl };
}

/** If URL + code (+ token) are saved, connect and return control URL. */
export async function tryStoredAutoConnect() {
  const result = await ensureDriverSession();
  if (result.ok) return result;
  if (result.reason === 'offline' && getStoredDriverToken()) {
    return { ok: true, controlUrl: result.controlUrl, plate: getStoredDriverPlate(), offline: true };
  }
  return result;
}

export function goToControl(controlUrl) {
  const url = normalizeControlUrl(controlUrl) || loadBusControlUrl();
  if (!url) return false;
  window.location.href = url;
  return true;
}

export function disconnectFromBus() {
  const controlUrl = loadBusControlUrl();
  const token = getStoredDriverToken();
  if (controlUrl && token) {
    fetchBusApi(controlUrl, '/api/driver/disconnect', {
      method: 'POST',
      headers: { 'X-Driver-Token': token },
    }).catch(() => {});
  }
  clearDriverCredentials();
  clearDriverBusSetup();
}
