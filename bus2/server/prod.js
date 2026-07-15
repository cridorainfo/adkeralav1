import { createServer as createHttpServer } from 'http';
import express from 'express';
import path from 'path';
import { setupDbApi, ensureDbLayout, readInfoFile } from './dbApi.js';
import { buildNetworkUrls, logNetworkStartup, findBestControlIp } from './networkInfo.js';
import {
  startCloudSyncLoop,
  getCloudConfig,
} from './cloudSync.js';
import { startMediaGcLoop } from './cloudMediaSync.js';
import { setupCloudProxy } from './cloudProxy.js';
import { shouldStartLocalAdmin, startLocalAdmin } from './localAdmin.js';
import { getAppRoot, getDataRoot, ensurePortableDb } from './getAppRoot.js';
import { startHttpsMirror } from './tls.js';
import { ensureWindowsFirewallPorts, checkFirewallPorts } from './firewall.js';
import { initHubSessions, setupHubSessions } from './hubSessions.js';
import { setupDriveApi } from './driveApi.js';
import { setupBusCors } from './cors.js';

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
  // Set by the hot-patch self-test runner (kiosk/hotpatchSelfTestRunner.mjs) when booting a
  // candidate patch on a scratch port purely to confirm it starts and answers requests. Skips
  // firewall-rule creation (would otherwise leave a junk "AdKerala Bus Port <scratch>" rule
  // behind on every self-test) and LAN/HTTPS setup (meaningless for a throwaway port nothing
  // ever connects to) — none of that is part of what a self-test needs to verify.
  const isSelfTest = Boolean(options.selfTest);

  if (process.env.ADKERALA_PACKAGED === '1') {
    ensurePortableDb(dataRoot);
  }

  let localAdmin = null;
  if (shouldStartLocalAdmin()) {
    localAdmin = await startLocalAdmin(dataRoot);
  }

  const app = express();
  setupBusCors(app);
  const httpServer = createHttpServer(app);
  app.use(express.json({ limit: '2mb' }));

  await ensureDbLayout(dataRoot);
  try {
    await readInfoFile(dataRoot);
  } catch (err) {
    console.warn('AdKerala: db/info.txt could not be loaded at startup —', err.message);
  }
  await initHubSessions(dataRoot);
  setupDbApi(app, dataRoot);
  setupHubSessions(app, { dataRoot });
  setupDriveApi(app, dataRoot);
  setupCloudProxy(app, dataRoot);

  let httpsInfo = { httpsEnabled: false, httpsPort: null };
  let firewallStatus = { ok: true, open: [], closed: [] };
  let lanProbe = { ok: null, error: null, ip: null, serverListening: null };

  const refreshLanProbe = async () => {
    const best = await findBestControlIp(PORT);
    lanProbe = {
      ok: best.ok,
      error: best.error ?? null,
      ip: best.ip,
      serverListening: best.serverListening ?? null,
    };
    return lanProbe;
  };

  app.get('/api/network', async (_req, res) => {
    if (lanProbe.ok === null) await refreshLanProbe();
    const urls = buildNetworkUrls(PORT, HOST, {
      ...httpsInfo,
      primaryIp: lanProbe.ip,
      lanReachable: lanProbe.ok,
      lanProbeError: lanProbe.error ?? null,
      serverListening: lanProbe.serverListening,
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
      serverListening: lanProbe.serverListening,
      adminUrl: localAdmin?.adminUrl ?? null,
      adminKeyHint: localAdmin?.adminKey ?? null,
    });
  });

  app.use(express.static(distDir, { index: false }));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });

  const stopCloud = startCloudSyncLoop(dataRoot);
  const stopMediaGc = startMediaGcLoop(dataRoot);

  let httpsMirror = { httpsServer: null, httpsPort: null, httpsEnabled: false };
  if (!isSelfTest) {
    try {
      httpsMirror = await startHttpsMirror(app, {
        dataRoot,
        httpPort: PORT,
        host: HOST,
      });
    } catch (err) {
      console.warn('AdKerala HTTPS disabled:', err.message);
    }
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
    serverListening: lanProbe.serverListening,
  });
  const firewallPorts = [PORT];
  if (httpsInfo.httpsEnabled && httpsInfo.httpsPort) {
    firewallPorts.push(httpsInfo.httpsPort);
  }
  let probeTimer = null;
  if (!isSelfTest) {
    ensureWindowsFirewallPorts(firewallPorts, process.env.ADKERALA_PACKAGED === '1' ? process.execPath : null);
    firewallStatus = checkFirewallPorts(firewallPorts);
    await refreshLanProbe();
    const startupProbeDelays = [2000, 5000, 10000, 20000];
    for (const ms of startupProbeDelays) {
      setTimeout(() => {
        refreshLanProbe().catch(() => {});
      }, ms);
    }
    probeTimer = setInterval(() => {
      refreshLanProbe().catch(() => {});
    }, 15000);
  }
  if (!isSelfTest && !lanProbe.ok) {
    if (lanProbe.error === 'no_lan_ip') {
      console.warn(
        '  No LAN IP yet - connect Wi-Fi or enable Mobile Hotspot on this PC.\n' +
          '           Driver QR will appear once a 192.168.x address is available.'
      );
    } else if (lanProbe.serverListening) {
      console.warn(
        `  LAN probe failed (${lanProbe.ip ?? 'unknown'}:${PORT}) - app is running but phones are blocked (firewall).\n` +
          '           Right-click allow-firewall.bat -> Run as administrator.'
      );
    } else {
      console.warn(
        `  LAN probe failed (${lanProbe.ip ?? 'unknown'}:${PORT}) - phones cannot connect yet (${lanProbe.error ?? 'blocked'}).\n` +
          '           Right-click allow-firewall.bat -> Run as administrator.'
      );
    }
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
    stopMediaGc();
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
      serverListening: lanProbe.serverListening,
    }),
    lanProbe,
    refreshLanProbe,
  };
}

const isDirectRun = process.argv[1]?.endsWith('prod.js');
if (isDirectRun) {
  const server = await startBusServer();
  const shutdownAndExit = () => {
    server.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', shutdownAndExit);
  // Windows doesn't deliver POSIX signals reliably to a fork()'d child, so kiosk/main.cjs's
  // supervisor asks for a graceful shutdown over IPC instead (see stopServerChild there) when
  // restarting this process for a hot patch or on app quit. process.send only exists when
  // actually forked (undefined for `node server/prod.js` directly), so this is a no-op there.
  if (typeof process.send === 'function') {
    process.on('message', (msg) => {
      if (msg?.__adkeralaShutdown) shutdownAndExit();
    });
  }
}
