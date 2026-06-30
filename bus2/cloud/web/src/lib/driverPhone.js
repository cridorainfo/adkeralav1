const DRIVER_ID_KEY = 'adkerala_driver_id';
const CLOUD_URL_KEY = 'adkerala_cloud_url';
const LAN_LINK_KEY = 'adkerala_lan_link';

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

/** Persist last bus LAN info so drivers can reopen control offline on bus Wi‑Fi. */
export function saveLanLink(entry) {
  if (!entry?.driverId) return;
  writeJson(LAN_LINK_KEY, {
    linked: true,
    driverId: entry.driverId,
    busId: entry.busId ?? null,
    lanIp: entry.lanIp ?? null,
    controlPort: entry.controlPort ?? 5174,
    pairingCode: entry.pairingCode ?? null,
    plate: entry.plate ?? '',
    linkedAt: entry.linkedAt ?? Date.now(),
  });
}

export function loadLanLink() {
  const entry = readJson(LAN_LINK_KEY);
  if (!entry?.driverId || !entry.linked) return null;
  return entry;
}

export function clearLanLink() {
  writeJson(LAN_LINK_KEY, null);
}

export function lanLinkForDriver(driverId) {
  const entry = loadLanLink();
  if (!entry || entry.driverId !== driverId) return null;
  return entry;
}

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

function locationPayload(driverId, location) {
  return {
    driverId,
    location: {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy ?? null,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      at: location.at ?? Date.now(),
    },
  };
}

export async function sendDriverLocation(driverId, location, cloudUrl, { keepalive = false } = {}) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url || !driverId || location?.lat == null || location?.lng == null) {
    return { ok: false };
  }
  const res = await fetch(`${url}/api/driver/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(locationPayload(driverId, location)),
    keepalive,
  });
  return res.json().catch(() => ({ ok: false }));
}

/** Last-resort push when tab closes or goes to background (works during page unload). */
export function sendDriverLocationBeacon(driverId, location, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url || !driverId || location?.lat == null || location?.lng == null) return false;
  if (typeof navigator.sendBeacon !== 'function') return false;
  const blob = new Blob([JSON.stringify(locationPayload(driverId, location))], {
    type: 'application/json',
  });
  return navigator.sendBeacon(`${url}/api/driver/location`, blob);
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

export async function sendDriverDrive(driverId, action, cloudUrl) {
  const url = cloudUrl ?? loadCloudUrl();
  if (!url || !driverId || !action) return { ok: false, error: 'Missing parameters' };
  const res = await fetch(`${url}/api/driver/drive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId, action }),
  });
  return res.json().catch(() => ({ ok: false, error: 'Network error' }));
}

export function controlUrlForSession(session) {
  if (!session?.lanIp) return null;
  const port = session.controlPort ?? 5174;
  return `http://${session.lanIp}:${port}/control`;
}

export function fullControlUrlForSession(session, driverId) {
  const base = controlUrlForSession(session);
  if (!base || !driverId) return base;
  const url = new URL(base);
  url.searchParams.set('driverId', driverId);
  if (session?.pairingCode) {
    url.searchParams.set('code', String(session.pairingCode).replace(/\D/g, '').slice(0, 4));
  }
  return url.toString();
}

/** Try cloud-paired unlock on bus LAN (no OTP). Works offline when bus has driverLink. */
export async function unlockLanWithDriverId(driverId, session) {
  const base = controlUrlForSession(session);
  if (!base || !driverId) return { ok: false, error: 'Join bus Wi‑Fi first' };
  const origin = base.replace(/\/control\/?$/, '');
  try {
    const res = await fetch(`${origin}/api/driver/unlock-paired`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driverId }),
    });
    const json = await res.json();
    if (json.ok) {
      saveLanLink({
        driverId,
        busId: session?.busId,
        lanIp: session?.lanIp,
        controlPort: session?.controlPort ?? 5174,
        pairingCode: session?.pairingCode,
        plate: json.plate ?? session?.plate,
        linkedAt: session?.linkedAt ?? Date.now(),
      });
    }
    return json;
  } catch {
    return { ok: false, error: 'Could not reach bus on Wi‑Fi' };
  }
}
