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

/** No-op — kept so connect flow can await hydration before reading localStorage. */
export async function hydrateDriverStorage() {
  /* PWA uses localStorage directly; nothing to preload. */
}

export function persistDriverValue(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode / storage blocked */
  }
}

export function removeDriverValues(keys) {
  for (const key of keys) persistDriverValue(key, null);
}
