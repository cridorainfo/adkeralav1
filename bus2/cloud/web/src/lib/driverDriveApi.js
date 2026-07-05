import { busFetch } from './driverBusApi.js';

/** Send a small drive command to the bus PC (LAN). State updates arrive via poll. */
export async function postDriveAction(action, payload = {}) {
  const res = await busFetch('/api/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(json.error || 'Drive command failed');
    if (json.code) err.code = json.code;
    else if (res.status === 403) err.code = 'DRIVER_LOCKED';
    throw err;
  }
  return json;
}
