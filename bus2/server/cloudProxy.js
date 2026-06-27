import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { applyCloudCommands } from './cloudCommands.js';
import { getCloudConfig } from './cloudSync.js';
import { reconcileStopAudioFromDisk } from './stopAudioReconcile.js';

const CLOUD_URL = () => getCloudConfig().cloudUrl;

export async function searchCloudRoutes(query) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(
    `${CLOUD_URL()}/api/routes/search?q=${encodeURIComponent(query)}`,
    { headers: adminKey ? { 'X-Admin-Key': adminKey } : {} }
  );
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function matchCloudRoutesByEndpoints(startEn, endEn) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const params = new URLSearchParams({
    start: String(startEn ?? ''),
    end: String(endEn ?? ''),
  });
  const res = await fetch(`${CLOUD_URL()}/api/routes/match?${params}`, {
    headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
  });
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function fetchCloudRoute(routeId) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return null;

  const res = await fetch(`${CLOUD_URL()}/api/routes/${encodeURIComponent(routeId)}`, {
    headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
  });
  const json = await res.json().catch(() => null);
  return json?.ok ? json.route : null;
}

export async function searchCloudStops(query) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(
    `${CLOUD_URL()}/api/stops/search?q=${encodeURIComponent(query)}`,
    { headers: adminKey ? { 'X-Admin-Key': adminKey } : {} }
  );
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function fetchAllCloudStops() {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(`${CLOUD_URL()}/api/stops`, {
    headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
  });
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function upsertCloudStop(stop) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(`${CLOUD_URL()}/api/stops`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
    },
    body: JSON.stringify(stop),
  });
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function publishCloudRoute(route) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(`${CLOUD_URL()}/api/routes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
    },
    body: JSON.stringify(route),
  });
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function fetchAllCloudRoutes() {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return { ok: false, error: 'Cloud not configured' };

  const res = await fetch(`${CLOUD_URL()}/api/routes`, {
    headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
  });
  return res.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
}

export async function assignRouteLocally(root, route) {
  const current = (await readInfoFile(root)) ?? {};
  const alreadyOnBus = (current.routes ?? []).some(
    (r) => r.id === route.id || r.cloudRouteId === route.id
  );
  const busRoute = {
    id: route.id,
    name: route.name,
    startStop: route.startStop,
    endStop: route.endStop,
    stops: route.stops ?? [],
    sharedFromCloud: true,
    cloudRouteId: route.id,
  };
  let stopCatalog = current.stopCatalog ?? [];
  for (const stop of [busRoute.startStop, ...(busRoute.stops ?? []), busRoute.endStop].filter(Boolean)) {
    if (!stop?.en) continue;
    const key = stop.en.trim().toLowerCase();
    const idx = stopCatalog.findIndex((s) => s.en?.trim().toLowerCase() === key);
    const entry = {
      en: stop.en.trim(),
      ml: stop.ml ?? '',
      lat: stop.lat ?? null,
      lng: stop.lng ?? null,
      radiusM: stop.radiusM ?? 80,
      updatedAt: Date.now(),
    };
    if (idx >= 0) stopCatalog[idx] = { ...stopCatalog[idx], ...entry };
    else stopCatalog.push(entry);
  }
  const merged = applyCloudCommands(current, [
    {
      type: alreadyOnBus ? 'UPSERT_ROUTE' : 'ASSIGN_ROUTE',
      payload: alreadyOnBus
        ? { route: busRoute, savedAt: Date.now() }
        : {
            route: busRoute,
            activeRouteId: route.id,
            savedAt: Date.now(),
          },
    },
  ]);
  merged.stopCatalog = stopCatalog;
  const { state: withAudio, changed: audioLinked } = await reconcileStopAudioFromDisk(root, merged);
  if (audioLinked) {
    await writeInfoFileSerialized(root, withAudio);
    return withAudio;
  }
  await writeInfoFileSerialized(root, merged);
  return merged;
}

export function setupCloudProxy(app, root) {
  app.get('/api/cloud/config', (_req, res) => {
    res.json({ ok: true, ...getCloudConfig() });
  });

  app.get('/api/cloud/routes/search', async (req, res) => {
    try {
      const json = await searchCloudRoutes(String(req.query.q ?? ''));
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cloud/routes/match', async (req, res) => {
    try {
      const json = await matchCloudRoutesByEndpoints(req.query.start, req.query.end);
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cloud/assign-route', async (req, res) => {
    try {
      const routeId = req.body?.routeId;
      if (!routeId) {
        res.status(400).json({ ok: false, error: 'Missing routeId' });
        return;
      }

      let route = await fetchCloudRoute(routeId);
      if (!route) {
        res.status(404).json({ ok: false, error: 'Route not found on cloud' });
        return;
      }

      const state = await assignRouteLocally(root, route);
      res.json({ ok: true, state, route });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cloud/routes', async (_req, res) => {
    try {
      const json = await fetchAllCloudRoutes();
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cloud/stops/search', async (req, res) => {
    try {
      const json = await searchCloudStops(String(req.query.q ?? ''));
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/cloud/stops', async (_req, res) => {
    try {
      const json = await fetchAllCloudStops();
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cloud/stops', async (req, res) => {
    try {
      const json = await upsertCloudStop(req.body ?? {});
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cloud/publish-route', async (req, res) => {
    try {
      const route = req.body?.route;
      if (!route?.name) {
        res.status(400).json({ ok: false, error: 'Missing route' });
        return;
      }
      const json = await publishCloudRoute(route);
      if (!json.ok) {
        res.status(400).json(json);
        return;
      }
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/cloud/driver/unlink', async (_req, res) => {
    try {
      const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
      const busId = getCloudConfig().busId;
      if (!CLOUD_URL()) {
        res.status(400).json({ ok: false, error: 'Cloud not configured' });
        return;
      }
      const cloudRes = await fetch(
        `${CLOUD_URL()}/api/buses/${encodeURIComponent(busId)}/unlink-driver`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
          },
          body: '{}',
        }
      );
      const json = await cloudRes.json().catch(() => ({ ok: false, error: 'Cloud unreachable' }));
      if (!json.ok) {
        res.status(400).json(json);
        return;
      }
      res.json(json);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
