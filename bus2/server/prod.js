import { createServer as createHttpServer } from 'http';
import express from 'express';
import path from 'path';
import { setupDbApi, ensureDbLayout, readInfoFile } from './dbApi.js';
import { buildNetworkUrls, logNetworkStartup, findBestControlIp } from './networkInfo.js';
import { startCloudSyncLoop, getCloudConfig, verifyDriverControlOnCloud, verifyDriverLinkedOnCloud } from './cloudSync.js';

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
  try {
    await readInfoFile(dataRoot);
  } catch (err) {
    console.warn('AdKerala: db/info.txt could not be loaded at startup —', err.message);
  }
  setupDbApi(app, dataRoot);
  setupDriverAuth(app, {
    dataRoot,
    verifyWithCloud: (pairingCode, otp) => verifyDriverControlOnCloud(dataRoot, pairingCode, otp),
    verifyLinkedWithCloud: (driverId) => verifyDriverLinkedOnCloud(dataRoot, driverId),
  });
  setupDriveApi(app, dataRoot);
  setupCloudProxy(app, dataRoot);

  let httpsInfo = { httpsEnabled: false, httpsPort: null };
  let firewallStatus = { ok: true, open: [], closed: [] };
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
    const cloudCfg = getCloudConfig(dataRoot);
    res.json({
      ok: true,
      ...urls,
      cloudDriverUrl: cloudCfg.publicUrl
        ? `${String(cloudCfg.publicUrl).replace(/\/$/, '')}/driver`
        : null,
      firewallOk: firewallStatus.ok,
      firewallClosedPorts: firewallStatus.closed,
      lanReachable: lanProbe.ok,
      lanProbeError: lanProbe.error ?? null,
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

  const urls = buildNetworkUrls(PORT, HOST, {
    ...httpsInfo,
    primaryIp: lanProbe.ip,
    lanReachable: lanProbe.ok,
    lanProbeError: lanProbe.error ?? null,
  });
  const firewallPorts = [PORT];
  if (httpsInfo.httpsEnabled && httpsInfo.httpsPort) {
    firewallPorts.push(httpsInfo.httpsPort);
  }
  ensureWindowsFirewallPorts(firewallPorts, process.env.ADKERALA_PACKAGED === '1' ? process.execPath : null);
  firewallStatus = checkFirewallPorts(firewallPorts);
  await refreshLanProbe();
  const probeTimer = setInterval(() => {
    refreshLanProbe().catch(() => {});
  }, 15000);
  if (!lanProbe.ok) {
    console.warn(
      `  LAN probe failed (${lanProbe.ip}:${PORT}) — phones cannot connect yet (${lanProbe.error ?? 'blocked'}).\n` +
        `           Right-click allow-firewall.bat → Run as administrator.`
    );
  }
  if (!firewallStatus.ok) {
    console.warn(
      `  Firewall: port(s) ${firewallStatus.closed.join(', ')} may block driver phones.\n` +
        `           Right-click allow-firewall.bat → Run as administrator (in the app folder).`
    );
  }
  logNetworkStartup(urls, {
    production: true,
    adminUrl: localAdmin?.adminUrl,
    adminKey: localAdmin?.adminKey,
  });

  const shutdown = () => {
    clearInterval(probeTimer);
    stopCloud();
    localAdmin?.stop();
    httpsMirror.httpsServer?.close();
    httpServer.close();
  };

  return {
    httpServer,
    httpsServer: httpsMirror.httpsServer,
    shutdown,
    port: PORT,
    host: HOST,
    root: dataRoot,
    appRoot,
    urls: buildNetworkUrls(PORT, HOST, {
      ...httpsInfo,
      primaryIp: lanProbe.ip,
      lanReachable: lanProbe.ok,
      lanProbeError: lanProbe.error ?? null,
    }),
    lanProbe,
    refreshLanProbe,
  };
}

const isDirectRun = process.argv[1]?.endsWith('prod.js');
if (isDirectRun) {
  const server = await startBusServer();
  process.on('SIGINT', () => {
    server.shutdown();
    process.exit(0);
  });
}
