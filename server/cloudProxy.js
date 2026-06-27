import { readInfoFile, writeInfoFile } from './dbApi.js';
import { applyCloudCommands } from './cloudCommands.js';
import { getCloudConfig } from './cloudSync.js';

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

export async function fetchCloudRoute(routeId) {
  const adminKey = process.env.ADKERALA_ADMIN_KEY ?? '';
  if (!CLOUD_URL()) return null;

  const res = await fetch(`${CLOUD_URL()}/api/routes/${encodeURIComponent(routeId)}`, {
    headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
  });
  const json = await res.json().catch(() => null);
  return json?.ok ? json.route : null;
}

export async function assignRouteLocally(root, route) {
  const current = (await readInfoFile(root)) ?? {};
  const busRoute = {
    id: route.id,
    name: route.name,
    startStop: route.startStop,
    endStop: route.endStop,
    stops: route.stops ?? [],
  };
  const merged = applyCloudCommands(current, [
    {
      type: 'ASSIGN_ROUTE',
      payload: {
        route: busRoute,
        activeRouteId: route.id,
        savedAt: Date.now(),
      },
    },
  ]);
  await writeInfoFile(root, merged);
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
}
