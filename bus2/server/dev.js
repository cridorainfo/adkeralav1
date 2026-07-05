import { createServer as createHttpServer } from 'http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, logNetworkStartup } from './networkInfo.js';
import {
  startCloudSyncLoop,
  getCloudConfig,
  verifyDriverControlOnCloud,
  verifyDriverLinkedOnCloud,
} from './cloudSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';
import { startHttpsMirror } from './tls.js';
import { ensureWindowsFirewallPorts } from './firewall.js';
import { setupDriverAuth } from './driverAuth.js';
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
setupDbApi(app, root);
setupDriverAuth(app, {
  dataRoot: root,
  verifyWithCloud: (pairingCode, otp) => verifyDriverControlOnCloud(root, pairingCode, otp),
  verifyLinkedWithCloud: (driverId) => verifyDriverLinkedOnCloud(root, driverId),
});
setupDriveApi(app, root);
setupCloudProxy(app, root);

let httpsInfo = { httpsEnabled: false, httpsPort: null };

app.get('/api/network', (_req, res) => {
  const urls = buildNetworkUrls(PORT, HOST, httpsInfo);
  const cloudCfg = getCloudConfig(root);
  res.json({
    ok: true,
    ...urls,
    cloudDriverUrl: cloudCfg.publicUrl
      ? `${String(cloudCfg.publicUrl).replace(/\/$/, '')}/driver`
      : null,
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

const urls = buildNetworkUrls(PORT, HOST, httpsInfo);

httpServer.listen(PORT, HOST, () => {
  const firewallPorts = [PORT];
  if (httpsInfo.httpsEnabled && httpsInfo.httpsPort) {
    firewallPorts.push(httpsInfo.httpsPort);
  }
  ensureWindowsFirewallPorts(firewallPorts);

  logNetworkStartup(urls, {
    adminUrl: localAdmin?.adminUrl,
    adminKey: localAdmin?.adminKey,
  });
});

process.on('SIGINT', () => {
  stopCloud();
  localAdmin?.stop();
  httpsMirror.httpsServer?.close();
  httpServer.close();
  process.exit(0);
});
