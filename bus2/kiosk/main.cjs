const { app, BrowserWindow, Menu, globalShortcut, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');
const { ensureFirewallOnce } = require('./firewall.cjs');
const { setupAutoUpdater } = require('./updater.cjs');

const PORT = Number(process.env.PORT ?? 5174);
const HTTPS_PORT = Number(process.env.ADKERALA_HTTPS_PORT ?? PORT + 1);
const DISPLAY_URL = `http://127.0.0.1:${PORT}/display?kiosk=1`;

let mainWindow = null;
let allowQuit = false;
let busServer = null;

function configureAppRoot() {
  if (app.isPackaged) {
    process.env.ADKERALA_PACKAGED = '1';
    process.env.ADKERALA_APP_PATH = app.getAppPath();
    // Portable EXE extracts to temp — db must live beside the user's .exe file.
    process.env.ADKERALA_DATA_ROOT =
      process.env.PORTABLE_EXECUTABLE_DIR ||
      path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'));
    process.env.ADKERALA_LOCAL_ADMIN = '0';
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

async function startServer() {
  const prodPath = path.join(__dirname, '..', 'server', 'prod.js');
  const { startBusServer } = await import(pathToFileURL(prodPath).href);
  busServer = await startBusServer({
    port: PORT,
    host: '0.0.0.0',
    appRoot: process.env.ADKERALA_APP_PATH || process.env.ADKERALA_ROOT,
    dataRoot: process.env.ADKERALA_DATA_ROOT || process.env.ADKERALA_ROOT,
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
    await startServer();
    await waitForServer(`http://127.0.0.1:${PORT}/`);
    createWindow();
    if (app.isPackaged) {
      setupAutoUpdater();
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
  busServer?.shutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
