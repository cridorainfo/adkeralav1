import { getStoredDriverToken } from './driverCredentials';
import { busFetch } from './driverBusApi';
import { ensureDriverSession } from './driverConnectFlow';

/** Send a small drive command to the bus PC (LAN). State updates arrive via SSE/poll. */
export async function postDriveAction(action, payload = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getStoredDriverToken();
  if (token) headers['X-Driver-Token'] = token;

  const res = await busFetch('/api/drive', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const locked = json.code === 'DRIVER_LOCKED' || res.status === 403;
    if (locked) {
      const recovered = await ensureDriverSession();
      if (recovered.ok) {
        const retryToken = getStoredDriverToken();
        const retryHeaders = { 'Content-Type': 'application/json' };
        if (retryToken) retryHeaders['X-Driver-Token'] = retryToken;
        const retryRes = await busFetch('/api/drive', {
          method: 'POST',
          headers: retryHeaders,
          body: JSON.stringify({ action, ...payload }),
        });
        const retryJson = await retryRes.json().catch(() => ({}));
        if (retryRes.ok && retryJson.ok) return retryJson;
      }
      if (recovered.keepTrying) {
        const err = new Error('Reconnecting to bus — try again in a moment');
        err.code = 'DRIVER_RECONNECTING';
        throw err;
      }
    }
    const err = new Error(json.error || 'Drive command failed');
    if (json.code) err.code = json.code;
    else if (res.status === 403) err.code = 'DRIVER_LOCKED';
    throw err;
  }
  return json;
}
