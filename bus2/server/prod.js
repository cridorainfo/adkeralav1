import { createServer as createHttpServer } from 'http';
import express from 'express';
import path from 'path';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, getLanAddresses } from './networkInfo.js';
import { startCloudSyncLoop } from './cloudSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';
import { getAppRoot, getDataRoot, ensurePortableDb } from './getAppRoot.js';

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

  app.get('/api/network', (_req, res) => {
    const urls = buildNetworkUrls(PORT, HOST);
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

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, HOST, resolve);
  });

  const urls = buildNetworkUrls(PORT, HOST);
  console.log(`\n  AdKerala (production)`);
  console.log(`  Display: ${urls.displayUrl}  (bus PC)`);
  console.log(`  Control: ${urls.controlUrl}  (driver phone)`);
  if (localAdmin) {
    console.log(`  Admin:   ${localAdmin.adminUrl}  (fleet dashboard)`);
    console.log(`           API key: ${localAdmin.adminKey}`);
  }
  console.log(`  Data:    db/info.txt  +  db/media/`);
  const lan = getLanAddresses();
  if (lan.length) {
    console.log(`  LAN:     ${lan.map((n) => n.address).join(', ')}`);
  } else {
    console.log(`  Local:   http://127.0.0.1:${PORT}/`);
  }
  console.log('');

  const shutdown = () => {
    stopCloud();
    localAdmin?.stop();
    httpServer.close();
  };

  return { httpServer, shutdown, port: PORT, host: HOST, root: dataRoot, appRoot, urls };
}

const isDirectRun = process.argv[1]?.endsWith('prod.js');
if (isDirectRun) {
  const server = await startBusServer();
  process.on('SIGINT', () => {
    server.shutdown();
    process.exit(0);
  });
}
