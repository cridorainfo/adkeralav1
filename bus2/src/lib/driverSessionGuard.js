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

/** True when admin disconnected all phones after this device last synced the stamp. */
export function isDevicesDisconnectRevoked(serverAt) {
  if (!serverAt) return false;
  const ack = loadDisconnectAck();
  if (!ack) return false;
  return String(serverAt) !== String(ack);
}

export function applyDriverSessionInfo(json = {}) {
  if (json.devicesDisconnectAt && isDevicesDisconnectRevoked(json.devicesDisconnectAt)) {
    return { revoked: true, devicesDisconnectAt: json.devicesDisconnectAt };
  }
  if (json.devicesDisconnectAt) {
    saveDisconnectAck(json.devicesDisconnectAt);
  }
  return { revoked: false, devicesDisconnectAt: json.devicesDisconnectAt ?? null };
}
