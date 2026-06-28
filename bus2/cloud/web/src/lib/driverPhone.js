const DRIVER_ID_KEY = 'adkerala_driver_id';
const CLOUD_URL_KEY = 'adkerala_cloud_url';

export function defaultCloudUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.origin.replace(/\/$/, '');
}

export function ensureDriverId() {
  let id = localStorage.getItem(DRIVER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DRIVER_ID_KEY, id);
  }
  return id;
}

export function loadCloudUrl() {
  const stored = localStorage.getItem(CLOUD_URL_KEY);
  if (stored) return stored.replace(/\/$/, '');
  return defaultCloudUrl();
}

export function setCloudUrl(url) {
  const trimmed = String(url ?? '').trim().replace(/\/$/, '');
  if (trimmed) localStorage.setItem(CLOUD_URL_KEY, trimmed);
  else localStorage.removeItem(CLOUD_URL_KEY);
}

export async function fetchDriverSession(driverId, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url) return { ok: false, error: 'Cloud URL not configured' };
  const res = await fetch(
    `${url}/api/driver/session?driverId=${encodeURIComponent(driverId)}`
  );
  return res.json();
}

export async function sendDriverHeartbeat(driverId, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url || !driverId) return { ok: false };
  const res = await fetch(`${url}/api/driver/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, appVersion: 'web' }),
  });
  return res.json().catch(() => ({ ok: false }));
}

export async function sendDriverLocation(driverId, location, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url || !driverId || location?.lat == null || location?.lng == null) {
    return { ok: false };
  }
  const res = await fetch(`${url}/api/driver/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driverId,
      location: {
        lat: location.lat,
        lng: location.lng,
        accuracy: location.accuracy ?? null,
        heading: location.heading ?? null,
        speed: location.speed ?? null,
        at: location.at ?? Date.now(),
      },
    }),
  });
  return res.json().catch(() => ({ ok: false }));
}

export async function pairDriver(driverId, plateOrCode, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url) return { ok: false, error: 'Cloud URL not configured' };
  const res = await fetch(`${url}/api/driver/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, plateOrCode: String(plateOrCode ?? '').trim() }),
  });
  return res.json();
}

export async function unlinkDriver(driverId, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
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
