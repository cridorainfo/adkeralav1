import { hubFetch, isOnBusLanOrigin } from './api.js';
import { getHubToken } from './persist.js';
import { ensureHubConnected } from './client.js';

async function sendDriveRequest(action, payload, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Hub-Token'] = token;

  const res = await hubFetch('/api/drive', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

/** Bus PC display / control on localhost — no driver hub session required. */
async function postLocalDriveAction(action, payload = {}) {
  const res = await fetch('/api/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    const err = new Error(json.error || 'Drive command failed');
    if (json.code) err.code = json.code;
    else if (res.status === 403) err.code = 'HUB_LOCKED';
    else if (res.status === 503) err.code = 'HUB_BOOT';
    else if (res.status === 409) err.code = json.code ?? 'NO_ROUTE';
    throw err;
  }
  return json;
}

/** Send a drive command to the bus PC hub. State updates arrive via SSE/poll. */
export async function postDriveAction(action, payload = {}) {
  if (isOnBusLanOrigin()) {
    return postLocalDriveAction(action, payload);
  }

  const session = await ensureHubConnected();
  if (!session.ok && !session.keepTrying) {
    const err = new Error('Not connected to bus — check Wi‑Fi and pair code');
    err.code = 'HUB_LOCKED';
    throw err;
  }

  let token = getHubToken();
  let { res, json } = await sendDriveRequest(action, payload, token);

  if ((!res.ok || !json.ok) && (json.code === 'HUB_LOCKED' || json.code === 'DRIVER_LOCKED' || res.status === 403 || json.code === 'HUB_BOOT')) {
    const recovered = await ensureHubConnected();
    if (recovered.ok) {
      token = getHubToken();
      ({ res, json } = await sendDriveRequest(action, payload, token));
    } else if (recovered.keepTrying) {
      const err = new Error('Reconnecting to bus — try again in a moment');
      err.code = 'HUB_RECONNECTING';
      throw err;
    }
  }

  if (!res.ok || !json.ok) {
    const err = new Error(json.error || 'Drive command failed');
    if (json.code) err.code = json.code;
    else if (res.status === 403) err.code = 'HUB_LOCKED';
    else if (res.status === 503) err.code = 'HUB_BOOT';
    else if (res.status === 409) err.code = json.code ?? 'NO_ROUTE';
    throw err;
  }
  return json;
}
