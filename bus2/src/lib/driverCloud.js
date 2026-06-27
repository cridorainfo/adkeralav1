const DRIVER_ID_KEY = 'adkerala_driver_id';
const CLOUD_URL_KEY = 'adkerala_cloud_url';

function isNative() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

async function readPref(key) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value;
  }
  return localStorage.getItem(key);
}

async function writePref(key, value) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
    return;
  }
  localStorage.setItem(key, value);
}

async function removePref(key) {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
    return;
  }
  localStorage.removeItem(key);
}

export async function ensureDriverId() {
  let id = await readPref(DRIVER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await writePref(DRIVER_ID_KEY, id);
  }
  return id;
}

/** Sync read for web; native apps should call ensureDriverId on mount. */
export function getDriverId() {
  let id = localStorage.getItem(DRIVER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DRIVER_ID_KEY, id);
  }
  return id;
}

export function getCloudUrl() {
  const env = import.meta.env.VITE_CLOUD_URL;
  if (env) return String(env).replace(/\/$/, '');
  const stored = localStorage.getItem(CLOUD_URL_KEY);
  return stored ? stored.replace(/\/$/, '') : '';
}

export async function loadCloudUrl() {
  const env = import.meta.env.VITE_CLOUD_URL;
  if (env) return String(env).replace(/\/$/, '');
  const stored = await readPref(CLOUD_URL_KEY);
  return stored ? stored.replace(/\/$/, '') : '';
}

export async function setCloudUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/\/$/, '');
  if (trimmed) await writePref(CLOUD_URL_KEY, trimmed);
  else await removePref(CLOUD_URL_KEY);
  if (!isNative()) {
    if (trimmed) localStorage.setItem(CLOUD_URL_KEY, trimmed);
    else localStorage.removeItem(CLOUD_URL_KEY);
  }
}

export async function fetchDriverSession(driverId, cloudUrl) {
  const url = cloudUrl ?? (await loadCloudUrl());
  if (!url) return { ok: false, error: 'Cloud URL not configured' };
  const res = await fetch(
    `${url}/api/driver/session?driverId=${encodeURIComponent(driverId)}`
  );
  return res.json();
}

export async function sendDriverHeartbeat(driverId, appVersion, cloudUrl) {
  const url = cloudUrl ?? (await loadCloudUrl());
  if (!url || !driverId) return { ok: false };
  const res = await fetch(`${url}/api/driver/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, appVersion }),
  });
  return res.json().catch(() => ({ ok: false }));
}

export async function pairDriver(driverId, plateOrCode, cloudUrl) {
  const url = cloudUrl ?? (await loadCloudUrl());
  if (!url) return { ok: false, error: 'Cloud URL not configured' };
  const res = await fetch(`${url}/api/driver/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, plateOrCode: String(plateOrCode ?? '').trim() }),
  });
  return res.json();
}

export async function unlinkDriver(driverId, cloudUrl) {
  const url = cloudUrl ?? (await loadCloudUrl());
  if (!url) return { ok: false, error: 'Cloud URL not configured' };
  const res = await fetch(`${url}/api/driver/unlink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  });
  return res.json();
}

export function controlUrlForSession(session) {
  if (!session?.lanIp) return null;
  const port = session.controlPort ?? 5174;
  return `http://${session.lanIp}:${port}/control`;
}
