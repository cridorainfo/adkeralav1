import { createServer as createHttpServer } from 'http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, getLanAddresses } from './networkInfo.js';
import { startCloudSyncLoop } from './cloudSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '0.0.0.0';

let localAdmin = null;
if (shouldStartLocalAdmin()) {
  localAdmin = await startLocalAdmin(root);
}

const app = express();
const httpServer = createHttpServer(app);
app.use(express.json({ limit: '2mb' }));

await ensureDbLayout(root);
setupDbApi(app, root);
setupCloudProxy(app, root);

app.get('/api/network', (_req, res) => {
  const urls = buildNetworkUrls(PORT, HOST);
  res.json({
    ok: true,
    ...urls,
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

httpServer.listen(PORT, HOST, () => {
  const urls = buildNetworkUrls(PORT, HOST);
  console.log(`\n  AdKerala`);
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
});

process.on('SIGINT', () => {
  stopCloud();
  localAdmin?.stop();
  httpServer.close();
  process.exit(0);
});
