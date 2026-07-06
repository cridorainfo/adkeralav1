import { createServer as createHttpServer } from 'http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, logNetworkStartup, findBestControlIp } from './networkInfo.js';
import {
  startCloudSyncLoop,
  getCloudConfig,
} from './cloudSync.js';
import { startMediaGcLoop } from './cloudMediaSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';
import { startHttpsMirror } from './tls.js';
import { ensureWindowsFirewallPorts } from './firewall.js';
import { initHubSessions, setupHubSessions } from './hubSessions.js';
import { setupDriveApi } from './driveApi.js';
import { setupBusCors } from './cors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '0.0.0.0';

let localAdmin = null;
if (shouldStartLocalAdmin()) {
  localAdmin = await startLocalAdmin(root);
}

const app = express();
setupBusCors(app);
const httpServer = createHttpServer(app);
app.use(express.json({ limit: '2mb' }));

await ensureDbLayout(root);
await initHubSessions(root);
setupDbApi(app, root);
setupHubSessions(app, { dataRoot: root });
setupDriveApi(app, root);
setupCloudProxy(app, root);

let httpsInfo = { httpsEnabled: false, httpsPort: null };
let lanProbe = { ok: null, error: null, ip: null };

const refreshLanProbe = async () => {
  const best = await findBestControlIp(PORT);
  lanProbe = { ok: best.ok, error: best.error ?? null, ip: best.ip };
  return lanProbe;
};

app.get('/api/network', async (_req, res) => {
  if (lanProbe.ok === null) await refreshLanProbe();
  const urls = buildNetworkUrls(PORT, HOST, {
    ...httpsInfo,
    primaryIp: lanProbe.ip,
    lanReachable: lanProbe.ok,
    lanProbeError: lanProbe.error ?? null,
  });
  const cloudCfg = getCloudConfig(root);
  res.json({
    ok: true,
    ...urls,
    cloudDriverUrl: cloudCfg.publicUrl
      ? `${String(cloudCfg.publicUrl).replace(/\/$/, '')}/driver`
      : null,
    lanReachable: lanProbe.ok,
    lanProbeError: lanProbe.error ?? null,
    adminUrl: localAdmin?.adminUrl ?? null,
    adminKeyHint: localAdmin?.adminKey ?? null,
  });
});

const vite = await createViteServer({
  root,
  server: {
    middlewareMode: true,
    hmr: { server: httpServer },
    host: HOST,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  appType: 'spa',
});

app.use(vite.middlewares);

const stopCloud = startCloudSyncLoop(root);
const stopMediaGc = startMediaGcLoop(root);

let httpsMirror = { httpsServer: null, httpsPort: null, httpsEnabled: false };
try {
  httpsMirror = await startHttpsMirror(app, {
    dataRoot: root,
    httpPort: PORT,
    host: HOST,
  });
} catch (err) {
  console.warn('AdKerala HTTPS disabled:', err.message);
}
httpsInfo = {
  httpsEnabled: httpsMirror.httpsEnabled,
  httpsPort: httpsMirror.httpsPort,
};

const urls = buildNetworkUrls(PORT, HOST, {
  ...httpsInfo,
  primaryIp: lanProbe.ip,
  lanReachable: lanProbe.ok,
  lanProbeError: lanProbe.error ?? null,
});

httpServer.listen(PORT, HOST, async () => {
  const firewallPorts = [PORT];
  if (httpsInfo.httpsEnabled && httpsInfo.httpsPort) {
    firewallPorts.push(httpsInfo.httpsPort);
  }
  ensureWindowsFirewallPorts(firewallPorts);
  await refreshLanProbe();
  setInterval(() => {
    refreshLanProbe().catch(() => {});
  }, 15000);

  logNetworkStartup(
    buildNetworkUrls(PORT, HOST, {
      ...httpsInfo,
      primaryIp: lanProbe.ip,
      lanReachable: lanProbe.ok,
      lanProbeError: lanProbe.error ?? null,
    }),
    {
      adminUrl: localAdmin?.adminUrl,
      adminKey: localAdmin?.adminKey,
    }
  );
});

process.on('SIGINT', () => {
  stopCloud();
  localAdmin?.stop();
  httpsMirror.httpsServer?.close();
  httpServer.close();
  process.exit(0);
});
