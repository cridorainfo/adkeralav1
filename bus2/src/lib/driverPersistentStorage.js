/** PWA / browser localStorage for driver credentials (bus URL, pairing code, session token). */

export const DRIVER_PERSIST_KEYS = [
  'adkerala_last_control_url',
  'adkerala_bus_control_url',
  'adkerala_saved_pair_code',
  'adkerala-driver-token',
  'adkerala-driver-bus',
  'adkerala-driver-plate',
  'adkerala-driver-id',
];

const memoryStore = new Map();

/** No-op — kept so connect flow can await hydration before reading localStorage. */
export async function hydrateDriverStorage() {
  /* PWA uses localStorage directly; nothing to preload. */
}

export function persistDriverValue(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / storage blocked — fall back to in-memory */
  }
  if (value == null) memoryStore.delete(key);
  else memoryStore.set(key, value);
}

export function readDriverValue(key) {
  try {
    const fromStorage = localStorage.getItem(key);
    if (fromStorage != null) {
      memoryStore.set(key, fromStorage);
      return fromStorage;
    }
  } catch {
    /* ignore */
  }
  return memoryStore.get(key) ?? null;
}

export function removeDriverValues(keys) {
  for (const key of keys) persistDriverValue(key, null);
}
