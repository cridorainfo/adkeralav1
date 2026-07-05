/** Hub client persistence — localStorage on web, Capacitor Preferences on native. */

export const HUB_PERSIST_KEYS = [
  'adkerala_hub_control_url',
  'adkerala_hub_pair_code',
  'adkerala_hub_token',
  'adkerala_hub_device_id',
  'adkerala_hub_plate',
  'adkerala_hub_origin',
  'adkerala_hub_disconnect_ack',
];

const memoryStore = new Map();

function isNative() {
  return Boolean(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.());
}

export async function hydrateHubStorage() {
  for (const key of HUB_PERSIST_KEYS) {
    try {
      if (isNative()) {
        const { Preferences } = await import('@capacitor/preferences');
        const { value } = await Preferences.get({ key });
        if (value != null) memoryStore.set(key, value);
      } else if (typeof localStorage !== 'undefined') {
        const value = localStorage.getItem(key);
        if (value != null) memoryStore.set(key, value);
      }
    } catch {
      /* ignore */
    }
  }
}

function persist(key, value) {
  if (value == null) memoryStore.delete(key);
  else memoryStore.set(key, value);

  try {
    if (typeof localStorage !== 'undefined') {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  } catch {
    /* private mode */
  }

  if (isNative()) {
    void (async () => {
      try {
        const { Preferences } = await import('@capacitor/preferences');
        if (value == null) await Preferences.remove({ key });
        else await Preferences.set({ key, value });
      } catch {
        /* ignore */
      }
    })();
  }
}

function read(key) {
  if (memoryStore.has(key)) return memoryStore.get(key);
  try {
    if (typeof localStorage !== 'undefined') {
      const fromStorage = localStorage.getItem(key);
      if (fromStorage != null) {
        memoryStore.set(key, fromStorage);
        return fromStorage;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function normalizeControlUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return null;
    if (url.pathname.includes('/driver')) {
      url.pathname = '/control';
    } else if (!url.pathname.includes('/control')) {
      url.pathname = `${url.pathname.replace(/\/$/, '')}/control`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function saveHubControlUrl(raw) {
  const normalized = normalizeControlUrl(raw);
  if (!normalized) return null;
  persist('adkerala_hub_control_url', normalized);
  return normalized;
}

export function loadHubControlUrl() {
  return normalizeControlUrl(read('adkerala_hub_control_url'));
}

export function saveHubPairCode(code) {
  const digits = String(code ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  if (digits.length !== 4) return;
  persist('adkerala_hub_pair_code', digits);
}

export function loadHubPairCode() {
  const value = read('adkerala_hub_pair_code');
  if (!value) return null;
  const digits = value.replace(/\D/g, '').slice(0, 4);
  return digits.length === 4 ? digits : null;
}

export function getHubOrigin() {
  const control = loadHubControlUrl();
  if (control) {
    try {
      return new URL(control).origin;
    } catch {
      /* fall through */
    }
  }
  return read('adkerala_hub_origin');
}

export function getHubToken() {
  return read('adkerala_hub_token');
}

export function getHubPlate() {
  return read('adkerala_hub_plate') ?? '';
}

export function getHubDeviceId() {
  let id = read('adkerala_hub_device_id');
  if (!id) {
    id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    persist('adkerala_hub_device_id', id);
  }
  return id;
}

export function saveHubSession({ token, plate, origin }) {
  persist('adkerala_hub_token', token);
  if (origin) persist('adkerala_hub_origin', origin);
  if (plate) persist('adkerala_hub_plate', plate);
}

export function clearHubToken() {
  persist('adkerala_hub_token', null);
}

export function saveDisconnectAck(at) {
  if (!at) return;
  persist('adkerala_hub_disconnect_ack', String(at));
}

export function loadDisconnectAck() {
  return read('adkerala_hub_disconnect_ack');
}

export function clearHubSetup() {
  for (const key of HUB_PERSIST_KEYS) {
    persist(key, null);
  }
}

export function readHubControlFromLocation(search = '') {
  const params = new URLSearchParams(search);
  const raw =
    params.get('control') || params.get('url') || params.get('bus') || params.get('controlUrl');
  if (raw) return normalizeControlUrl(raw);

  if (typeof window !== 'undefined' && window.location.pathname.includes('/driver')) {
    return normalizeControlUrl(`${window.location.origin}/control`);
  }

  return null;
}
