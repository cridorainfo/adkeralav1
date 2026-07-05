import { persistDriverValue, removeDriverValues } from './driverPersistentStorage.js';

const DISCONNECT_ACK_KEY = 'adkerala-devices-disconnect-at';
const memoryStore = new Map();

function storageGet(key) {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key, value) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return;
    }
  } catch {
    /* ignore */
  }
  if (value == null) memoryStore.delete(key);
  else memoryStore.set(key, value);
}

export function loadDisconnectAck() {
  return storageGet(DISCONNECT_ACK_KEY);
}

export function saveDisconnectAck(at) {
  if (!at) return;
  storageSet(DISCONNECT_ACK_KEY, String(at));
}

export function clearDisconnectAck() {
  removeDriverValues([DISCONNECT_ACK_KEY]);
  memoryStore.delete(DISCONNECT_ACK_KEY);
}

/** Track admin disconnect-all stamps (informational — revoke uses token validity, bus3-style). */
export function isDevicesDisconnectRevoked(serverAt) {
  if (!serverAt) return false;
  const ack = loadDisconnectAck();
  if (!ack) return false;
  return String(serverAt) !== String(ack);
}

/** Session info from /api/driver/unlock-status — never wipe setup on stamp alone. */
export function applyDriverSessionInfo(json = {}) {
  if (json.devicesDisconnectAt) {
    saveDisconnectAck(json.devicesDisconnectAt);
  }
  return {
    revoked: false,
    devicesDisconnectAt: json.devicesDisconnectAt ?? null,
    unlocked: Boolean(json.unlocked),
  };
}
