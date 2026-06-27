import { createServer as createHttpServer } from 'http';
import express from 'express';
import path from 'path';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, logNetworkStartup } from './networkInfo.js';
import { startCloudSyncLoop } from './cloudSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';
import { getAppRoot, getDataRoot, ensurePortableDb } from './getAppRoot.js';
import { startHttpsMirror, getHttpsPort } from './tls.js';
import { ensureWindowsFirewallPorts } from './firewall.js';

/**
 * Production bus server — static SPA + same API as dev.js (no Vite).
 * Used by Electron kiosk and `node server/prod.js`.
 */
export async function startBusServer(options = {}) {
  const appRoot = options.appRoot ?? getAppRoot();
  const dataRoot = options.dataRoot ?? options.root ?? getDataRoot();
  const PORT = Number(options.port ?? process.env.PORT ?? 5174);
  const HOST = options.host ?? process.env.HOST ?? '0.0.0.0';
  const distDir = path.join(appRoot, 'dist');

  if (process.env.ADKERALA_PACKAGED === '1') {
    ensurePortableDb(dataRoot);
  }

  let localAdmin = null;
  if (shouldStartLocalAdmin()) {
    localAdmin = await startLocalAdmin(dataRoot);
  }

  const app = express();
  const httpServer = createHttpServer(app);
  app.use(express.json({ limit: '2mb' }));

  await ensureDbLayout(dataRoot);
  setupDbApi(app, dataRoot);
  setupCloudProxy(app, dataRoot);

  let httpsInfo = { httpsEnabled: false, httpsPort: null };

  app.get('/api/network', (_req, res) => {
    const urls = buildNetworkUrls(PORT, HOST, httpsInfo);
    res.json({
      ok: true,
      ...urls,
      adminUrl: localAdmin?.adminUrl ?? null,
      adminKeyHint: localAdmin?.adminKey ?? null,
    });
  });

  app.use(express.static(distDir, { index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const stopCloud = startCloudSyncLoop(dataRoot);

  let httpsMirror = { httpsServer: null, httpsPort: null, httpsEnabled: false };
  try {
    httpsMirror = await startHttpsMirror(app, {
      dataRoot,
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

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, HOST, resolve);
  });

  const urls = buildNetworkUrls(PORT, HOST, httpsInfo);
  const firewallPorts = [PORT];
  if (httpsInfo.httpsEnabled && httpsInfo.httpsPort) {
    firewallPorts.push(httpsInfo.httpsPort);
  }
  ensureWindowsFirewallPorts(firewallPorts);
  logNetworkStartup(urls, {
    production: true,
    adminUrl: localAdmin?.adminUrl,
    adminKey: localAdmin?.adminKey,
  });

  const shutdown = () => {
    stopCloud();
    localAdmin?.stop();
    httpsMirror.httpsServer?.close();
    httpServer.close();
  };

  return { httpServer, httpsServer: httpsMirror.httpsServer, shutdown, port: PORT, host: HOST, root: dataRoot, appRoot, urls };
}

const isDirectRun = process.argv[1]?.endsWith('prod.js');
if (isDirectRun) {
  const server = await startBusServer();
  process.on('SIGINT', () => {
    server.shutdown();
    process.exit(0);
  });
}
