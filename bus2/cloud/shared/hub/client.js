import { hubFetch, isOnBusLanOrigin } from './api.js';
import {
  clearHubSetup,
  clearHubToken,
  getHubDeviceId,
  getHubOrigin,
  getHubPlate,
  getHubToken,
  hydrateHubStorage,
  loadDisconnectAck,
  loadHubControlUrl,
  loadHubPairCode,
  resetHubSessionForNewBus,
  saveDisconnectAck,
  saveHubControlUrl,
  saveHubPairCode,
  saveHubSession,
} from './persist.js';

const PING_MS = 5_000;

let pingTimer = null;
let connectMutex = Promise.resolve();

function withMutex(fn) {
  const run = connectMutex.then(fn, fn);
  connectMutex = run.catch(() => {});
  return run;
}

function isRevoked(devicesDisconnectAt) {
  if (!devicesDisconnectAt) return false;
  const ack = loadDisconnectAck();
  if (!ack) return false;
  return String(devicesDisconnectAt) !== String(ack);
}

async function hubPost(path, body = {}) {
  const origin = getHubOrigin();
  if (!origin && !loadHubControlUrl()) throw new Error('No bus address saved');
  const res = await hubFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function readStatus() {
  const res = await hubFetch('/api/hub/status');
  return res.json();
}

/** Pair with saved bus URL + 4-digit code. Idempotent per deviceId on server. */
export async function pairToHub(controlUrl, pairingCode) {
  const normalized = saveHubControlUrl(controlUrl);
  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (!normalized || code.length !== 4) {
    return { ok: false, error: 'Enter the 4-digit pairing code from admin' };
  }

  const origin = getHubOrigin();
  if (!origin) return { ok: false, error: 'Invalid bus address' };

  try {
    const { json } = await hubPost('/api/hub/pair', {
      pairingCode: code,
      deviceId: getHubDeviceId(),
    });
    if (!json.ok) {
      return { ok: false, error: json.error ?? 'Wrong pairing code — check with admin' };
    }

    saveHubPairCode(code);
    saveHubSession({
      token: json.token,
      plate: json.plate ?? '',
      origin,
    });
    if (json.devicesDisconnectAt) saveDisconnectAck(json.devicesDisconnectAt);

    return { ok: true, plate: json.plate ?? '', reused: Boolean(json.reused) };
  } catch (err) {
    const offlineHint =
      'Could not reach bus — join the same Wi‑Fi as the display PC, turn off mobile data, and run allow-firewall.bat on the bus PC';
    if (typeof console !== 'undefined' && err) {
      console.warn('AdKerala hub pair failed:', err?.message ?? err);
    }
    return { ok: false, error: offlineHint };
  }
}

/**
 * Ensure an active hub session — single mutex, idempotent reconnect.
 * Returns { ok, status: 'connected'|'reconnecting'|'revoked'|'need-code'|'no-url', plate?, error? }
 */
export async function ensureHubConnected() {
  return withMutex(async () => {
    await hydrateHubStorage();
    const controlUrl = loadHubControlUrl();
    if (!controlUrl) return { ok: false, status: 'no-url' };

    const token = getHubToken();
    const code = loadHubPairCode();

    try {
      const status = await readStatus();
      if (status.devicesDisconnectAt) saveDisconnectAck(status.devicesDisconnectAt);

      if (isRevoked(status.devicesDisconnectAt)) {
        clearHubSetup();
        return {
          ok: false,
          status: 'revoked',
          error: 'Admin disconnected all phones — scan the bus QR and pair again',
        };
      }

      if (token && status.connected) {
        return { ok: true, status: 'connected', plate: status.plate ?? getHubPlate() };
      }

      if (token && !status.connected) {
        clearHubToken();
      }

      if (code) {
        const result = await pairToHub(controlUrl, code);
        if (result.ok) {
          return { ok: true, status: 'connected', plate: result.plate ?? getHubPlate() };
        }
        return {
          ok: false,
          status: 'reconnecting',
          error: result.error,
          keepTrying: true,
        };
      }
    } catch {
      if (token || code) {
        return {
          ok: true,
          status: 'reconnecting',
          plate: getHubPlate(),
          keepTrying: true,
          offline: true,
        };
      }
      return { ok: false, status: 'reconnecting', keepTrying: Boolean(code) };
    }

    if (!code) return { ok: false, status: 'need-code' };

    const result = await pairToHub(controlUrl, code);
    if (result.ok) return { ok: true, status: 'connected', plate: result.plate ?? '' };
    return { ok: false, status: 'reconnecting', error: result.error, keepTrying: true };
  });
}

export async function tryStoredHubConnect() {
  const result = await ensureHubConnected();
  const controlUrl = loadHubControlUrl();
  if (result.status === 'connected') return { ok: true, ...result, controlUrl };
  if (result.status === 'revoked') return { ...result, controlUrl };
  if (result.keepTrying) {
    return {
      ok: false,
      status: 'reconnecting',
      controlUrl,
      plate: getHubPlate(),
      offline: Boolean(result.offline),
      error: result.error,
      keepTrying: true,
    };
  }
  return { ...result, controlUrl };
}

/** Save bus control URL (no secrets in the URL), then reconnect if this device already paired. */
export async function connectAfterBusUrlSaved(controlUrl) {
  if (!controlUrl) return { ok: false, status: 'no-url', controlUrl: null };
  const previous = loadHubControlUrl();
  const normalized = saveHubControlUrl(controlUrl);
  if (!normalized) return { ok: false, status: 'invalid-url', controlUrl: null };
  if (previous && previous !== normalized) {
    resetHubSessionForNewBus();
  }
  return tryStoredHubConnect();
}

export function shouldOpenHubControl(auto) {
  return Boolean(auto?.ok && auto.status === 'connected' && auto.controlUrl);
}

/** Where to send the driver after pairing — PWA stays on /driver/control, bus LAN opens /control. */
export function resolveHubControlDestination(controlUrl) {
  const url = saveHubControlUrl(controlUrl) || loadHubControlUrl();
  if (!url) return null;
  if (isOnBusLanOrigin()) return url;
  return '/driver/control';
}

export function goToHubControl(controlUrl) {
  const dest = resolveHubControlDestination(controlUrl);
  if (!dest) return false;
  window.location.href = dest;
  return true;
}

export async function disconnectFromHub() {
  const token = getHubToken();
  if (token) {
    try {
      await hubFetch('/api/hub/disconnect', { method: 'POST' });
    } catch {
      /* offline */
    }
  }
  clearHubSetup();
  stopHubPing();
  return { ok: true };
}

export async function disconnectAllHubDevices() {
  try {
    const res = await fetch('/api/hub/disconnect-all', { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.error ?? 'Could not disconnect devices' };
    }
    return { ok: true, connectedDeviceCount: json.connectedDeviceCount ?? 0 };
  } catch (err) {
    return { ok: false, error: err.message ?? 'Could not disconnect devices' };
  }
}

async function pingHub() {
  try {
    const { json } = await hubPost('/api/hub/ping', {});
    if (json.devicesDisconnectAt) saveDisconnectAck(json.devicesDisconnectAt);
    if (isRevoked(json.devicesDisconnectAt)) {
      clearHubSetup();
      return { ok: false, revoked: true };
    }
    if (json.ok) return { ok: true };
    if (json.stale) {
      const recovered = await ensureHubConnected();
      return { ok: recovered.ok, revoked: recovered.status === 'revoked' };
    }
  } catch {
    return { ok: false, offline: true };
  }
  return { ok: false };
}

/** One global ping loop — call startHubPing once from the control shell. */
export function startHubPing(onChange) {
  stopHubPing();
  const tick = async () => {
    const result = await pingHub();
    onChange?.(result);
  };
  tick();
  pingTimer = setInterval(tick, PING_MS);
}

export function stopHubPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}
