import { createServer as createHttpServer } from 'http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupDbApi, ensureDbLayout } from './dbApi.js';
import { buildNetworkUrls, getLanAddresses } from './networkInfo.js';
import { startCloudSyncLoop } from './cloudSync.js';
import { setupCloudProxy } from './cloudProxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = Number(process.env.PORT ?? 5174);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();
const httpServer = createHttpServer(app);
app.use(express.json({ limit: '2mb' }));

await ensureDbLayout(root);
setupDbApi(app, root);
setupCloudProxy(app, root);

app.get('/api/network', (_req, res) => {
  const urls = buildNetworkUrls(PORT, HOST);
  res.json({ ok: true, ...urls });
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
  httpServer.close();
  process.exit(0);
});
