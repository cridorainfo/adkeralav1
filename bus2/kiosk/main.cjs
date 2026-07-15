const { app, BrowserWindow, Menu, globalShortcut, dialog, session } = require('electron');
const path = require('path');
const http = require('http');
const fsp = require('fs/promises');
const { execSync, fork } = require('child_process');
const { ensureFirewallOnce } = require('./firewall.cjs');
const {
  configureAutoUpdater,
  checkForUpdatesAtBoot,
  startPeriodicUpdateChecks,
  handleKioskCommand,
} = require('./updater.cjs');
const { setKioskCommandHandler, attachToChild } = require('./kioskBridge.cjs');
const { applyPackagedDefaults, isGenuineNsisInstall } = require('./installEnv.cjs');
const { setupWebSerial } = require('./serialPort.cjs');
const hotpatch = require('./hotpatchSupervisor.cjs');

const PORT = Number(process.env.PORT ?? 5174);
const HTTPS_PORT = Number(process.env.ADKERALA_HTTPS_PORT ?? PORT + 1);
const DISPLAY_URL = `http://127.0.0.1:${PORT}/display?kiosk=1`;

let mainWindow = null;
let allowQuit = false;
// The bus server used to run in-process (an in-process import() of server/prod.js). It's now
// a genuine child_process — required so hot-patched server code (see hotpatchSupervisor.cjs)
// can be swapped in with a real process restart instead of a fragile in-process ESM module-cache
// hot-reload, while the Electron shell/window keeps running undisturbed throughout.
let serverChild = null;

function configureAppRoot() {
  if (app.isPackaged) {
    applyPackagedDefaults(app);
  } else {
    process.env.ADKERALA_ROOT = path.join(__dirname, '..');
  }
}

function freePort(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', shell: true });
      const pids = new Set();
      for (const line of out.split('\n')) {
        const match = line.trim().match(/\s(\d+)\s*$/);
        if (match) pids.add(match[1]);
      }
      for (const pid of pids) {
        if (pid && pid !== '0' && pid !== String(process.pid)) {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', shell: true });
        }
      }
    } catch {
      /* port already free */
    }
    return;
  }

  try {
    execSync(`npx --yes kill-port ${port}`, { stdio: 'ignore', shell: true, timeout: 15000 });
  } catch {
    /* port already free or kill-port unavailable */
  }
}

function waitForServer(url, attempts = 45) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else if (tries >= attempts) reject(new Error('Server did not respond'));
        else setTimeout(tick, 1000);
      });
      req.on('error', () => {
        if (tries >= attempts) reject(new Error('Server did not start in time'));
        else setTimeout(tick, 1000);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (tries >= attempts) reject(new Error('Server did not start in time'));
        else setTimeout(tick, 1000);
      });
    };
    tick();
  });
}

function currentAppRoot() {
  return process.env.ADKERALA_APP_PATH || process.env.ADKERALA_ROOT;
}
function currentDataRoot() {
  return process.env.ADKERALA_DATA_ROOT || process.env.ADKERALA_ROOT;
}
function baseServerEntry() {
  return path.join(currentAppRoot(), 'server', 'prod.js');
}

/** Fork one server child at the given server/prod.js entry path; resolves once the OS has
 * actually spawned it (not once it's answering requests — callers that need that use
 * waitForServer separately, same helper already used at first boot). */
function forkServerChild(serverEntryPath) {
  return new Promise((resolve, reject) => {
    const child = fork(serverEntryPath, [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, PORT: String(PORT) },
    });
    attachToChild(child);
    let settled = false;
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      resolve(child);
    });
  });
}

/** Ask a server child to shut down gracefully over IPC; force-kills if it doesn't exit in time. */
function stopServerChild(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      resolve();
    };
    child.once('exit', finish);
    const killTimer = setTimeout(() => {
      if (!settled) child.kill();
    }, timeoutMs);
    if (typeof child.send === 'function') {
      child.send({ __adkeralaShutdown: true });
    } else {
      child.kill();
    }
  });
}

async function startServer() {
  const appRoot = currentAppRoot();
  const dataRoot = currentDataRoot();
  const { entry, version } = await hotpatch.resolveActiveServerEntry({ dataRoot, appRoot });
  console.log(
    `AdKerala: starting server (${version === 'base' ? 'base install' : `hot patch ${version}`})`
  );
  serverChild = await forkServerChild(entry);
}

/**
 * Live-swap the running server child to a different version (a hot patch just applied, or
 * a fallback). The window and everything Electron-side keeps running the whole time — only
 * the server child restarts, and the already-loaded display page reconnects on its own
 * (same EventSource auto-reconnect the display already relies on for any brief connection
 * drop). If the new entry doesn't come up cleanly, falls back to serverEntryPath's sibling
 * so the bus is never left with no server running at all.
 */
async function restartServerTo(serverEntryPath, { fallbackEntryPath } = {}) {
  const previousChild = serverChild;
  await stopServerChild(previousChild);
  try {
    serverChild = await forkServerChild(serverEntryPath);
    await waitForServer(`http://127.0.0.1:${PORT}/`, 15);
    return true;
  } catch (err) {
    console.warn('AdKerala hotpatch: live restart failed —', err.message);
    if (fallbackEntryPath && fallbackEntryPath !== serverEntryPath) {
      try {
        serverChild = await forkServerChild(fallbackEntryPath);
        await waitForServer(`http://127.0.0.1:${PORT}/`, 15);
      } catch (fallbackErr) {
        console.error('AdKerala hotpatch: fallback restart also failed —', fallbackErr.message);
      }
    }
    return false;
  }
}

/**
 * Handles the APPLY_SERVER_HOTPATCH kiosk command dispatched (over IPC) by
 * server/cloudSync.js's syncServerHotpatchFromCloud once it has downloaded and
 * checksum-verified a patch bundle. Applying (extract + self-test on a scratch port +
 * commit the pointer) happens here in the main process — only it can then trigger the
 * live server-child swap once the patch has proven it boots.
 */
async function handleServerHotpatchCommand(payload = {}) {
  const { zipPath, version, sha256 } = payload;
  if (!zipPath || !version) return;

  const appRoot = currentAppRoot();
  const dataRoot = currentDataRoot();

  let zipBuffer;
  try {
    zipBuffer = await fsp.readFile(zipPath);
  } catch (err) {
    console.warn('AdKerala hotpatch: could not read downloaded bundle —', err.message);
    return;
  }

  const result = await hotpatch.applyPatch({ dataRoot, appRoot, version, zipBuffer, sha256 });
  await fsp.unlink(zipPath).catch(() => {});

  if (!result.ok) {
    console.warn(`AdKerala hotpatch: v${version} not applied —`, result.reason);
    return;
  }

  console.log(`AdKerala hotpatch: v${version} passed self-test — swapping in live now`);
  await restartServerTo(hotpatch.versionServerEntry(dataRoot, result.version), {
    fallbackEntryPath: baseServerEntry(),
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    kiosk: true,
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (e) => {
    if (!allowQuit) e.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.insertCSS('html, html * { cursor: none !important; }');
  });

  mainWindow.loadURL(DISPLAY_URL);
}

app.whenReady().then(async () => {
  try {
    configureAppRoot();
    freePort(PORT);
    if (process.env.ADKERALA_HTTPS !== '0') {
      freePort(HTTPS_PORT);
    }
    await ensureFirewallOnce(PORT);
    setupWebSerial(session.defaultSession);
    await startServer();
    await waitForServer(`http://127.0.0.1:${PORT}/`);

    // Auto-update only works for a copy the NSIS installer recognizes (has
    // an Uninstall*.exe) — it can silently update that install in place. Any
    // other packaged copy (a manually placed "dir"/portable build) would have
    // its silent Setup.exe run land a fresh, unclaimed install elsewhere
    // instead of updating itself — see isGenuineNsisInstall in installEnv.cjs.
    const canAutoUpdate = app.isPackaged && isGenuineNsisInstall(app);

    if (app.isPackaged && !canAutoUpdate) {
      console.warn(
        'AdKerala: this copy is not a registered NSIS install (no Uninstall*.exe) — ' +
          'auto-update disabled to avoid spawning a duplicate, unclaimed install elsewhere. ' +
          'Run the official AdKeralaDisplay-Setup-X.Y.Z.exe on this PC to enable updates.'
      );
    }

    if (canAutoUpdate) {
      setKioskCommandHandler((type, payload) => {
        if (type === 'APPLY_SERVER_HOTPATCH') {
          handleServerHotpatchCommand(payload).catch((err) => {
            console.warn('AdKerala hotpatch: command handling failed —', err.message);
          });
          return;
        }
        handleKioskCommand(type, payload);
      });
      configureAutoUpdater({
        getMainWindow: () => mainWindow,
        setAllowQuit: (value = true) => {
          allowQuit = value;
        },
      });
      // Power-on is when this bus reliably has no passengers mid-route yet, so
      // it's the safest moment to apply a pending update — check (and install
      // if one's already downloaded) before the kiosk window ever appears.
      await checkForUpdatesAtBoot();
    }

    createWindow();

    if (canAutoUpdate) {
      startPeriodicUpdateChecks();
    }

    globalShortcut.register('Control+Shift+Q', () => {
      allowQuit = true;
      app.quit();
    });
  } catch (err) {
    console.error('AdKerala kiosk failed to start:', err);
    dialog.showErrorBox('AdKerala failed to start', String(err?.message ?? err));
    app.exit(1);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  // Best-effort — will-quit can't block Electron's own teardown on this resolving, but a
  // graceful IPC shutdown request beats an unconditional kill() when the child does have
  // time to act on it (e.g. this fires before the OS forcibly ends things).
  if (serverChild) stopServerChild(serverChild);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
