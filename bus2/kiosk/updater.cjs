const { autoUpdater } = require('electron-updater');
const { APP_VERSION } = require('./version.cjs');

const CHECK_INTERVAL_MS = Number(process.env.ADKERALA_UPDATE_INTERVAL_MS ?? 15 * 60 * 1000);
const RESTART_DELAY_MS = Number(process.env.ADKERALA_UPDATE_RESTART_DELAY_MS ?? 3 * 60 * 1000);
const ADMIN_RESTART_DELAY_MS = Number(process.env.ADKERALA_UPDATE_ADMIN_DELAY_MS ?? 60 * 1000);

let getMainWindow = () => null;
let setAllowQuit = () => {};
let restartTimer = null;
let countdownTimer = null;
let updateDownloaded = false;
let pendingVersion = null;
let pendingRestartDelayMs = RESTART_DELAY_MS;
let minVersionRequired = null;

function getCloudUrl() {
  return (process.env.ADKERALA_CLOUD_URL ?? '').replace(/\/+$/, '');
}

function compareSemver(a, b) {
  const pa = String(a ?? '0').split('.').map((n) => Number(n) || 0);
  const pb = String(b ?? '0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function emitStatus(payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('update-status', payload);
  }
}

function clearRestartTimers() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function performInstall() {
  clearRestartTimers();
  setAllowQuit(true);
  emitStatus({ visible: true, phase: 'installing', version: pendingVersion });
  autoUpdater.quitAndInstall(false, true);
}

function scheduleInstall(delayMs, reason) {
  clearRestartTimers();
  const delay = Math.max(5000, Number(delayMs) || RESTART_DELAY_MS);
  const deadline = Date.now() + delay;

  const tick = () => {
    const leftMs = Math.max(0, deadline - Date.now());
    emitStatus({
      visible: true,
      phase: 'downloaded',
      version: pendingVersion,
      restartInSec: Math.ceil(leftMs / 1000),
      reason,
    });
    if (leftMs <= 0) {
      performInstall();
    }
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
  restartTimer = setTimeout(performInstall, delay);
}

function onUpdateDownloaded(info) {
  updateDownloaded = true;
  pendingVersion = info?.version ?? null;
  console.log('AdKerala updater: downloaded v' + pendingVersion + ' — restart scheduled');
  scheduleInstall(pendingRestartDelayMs, 'update');
  pendingRestartDelayMs = RESTART_DELAY_MS;
}

function handleAdminPushUpdate(payload = {}) {
  const delaySec = Number(payload.delaySec);
  const delayMs =
    Number.isFinite(delaySec) && delaySec >= 0
      ? delaySec * 1000
      : ADMIN_RESTART_DELAY_MS;

  console.log('AdKerala updater: admin push — apply update in', Math.round(delayMs / 1000), 's');

  if (updateDownloaded) {
    scheduleInstall(delayMs, 'admin');
    return;
  }

  pendingRestartDelayMs = delayMs;
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('AdKerala updater check failed:', err?.message ?? err);
  });
}

function handleKioskCommand(type, payload) {
  if (type === 'APPLY_UPDATE') {
    handleAdminPushUpdate(payload);
  }
}

/** Configure electron-updater to pull latest.yml from the cloud admin server. */
function setupAutoUpdater(deps = {}) {
  getMainWindow = deps.getMainWindow ?? getMainWindow;
  setAllowQuit = deps.setAllowQuit ?? setAllowQuit;

  const cloudUrl = getCloudUrl();
  if (!cloudUrl) {
    console.log('AdKerala updater: disabled (set ADKERALA_CLOUD_URL)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `${cloudUrl}/api/releases/pc`,
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('AdKerala updater: checking…', `(current v${APP_VERSION})`);
    emitStatus({ visible: false, phase: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('AdKerala updater: update available →', info.version);
    emitStatus({ visible: true, phase: 'downloading', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('AdKerala updater: up to date');
    emitStatus({ visible: false, phase: 'current', version: APP_VERSION });
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent ?? 0);
    if (pct % 25 === 0) console.log(`AdKerala updater: download ${pct}%`);
    emitStatus({ visible: true, phase: 'downloading', percent: pct, version: pendingVersion });
  });

  autoUpdater.on('update-downloaded', onUpdateDownloaded);

  autoUpdater.on('error', (err) => {
    console.warn('AdKerala updater:', err?.message ?? err);
    emitStatus({ visible: false, phase: 'error', message: String(err?.message ?? err) });
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('AdKerala updater check failed:', err?.message ?? err);
    });
  };

  setTimeout(check, 15000);
  setInterval(check, CHECK_INTERVAL_MS);

  setTimeout(async () => {
    try {
      const res = await fetch(`${cloudUrl}/api/releases/pc/latest`);
      const json = await res.json();
      minVersionRequired = json?.minVersion ?? null;
      if (minVersionRequired && compareSemver(APP_VERSION, minVersionRequired) < 0) {
        console.warn(
          `AdKerala updater: below minimum PC version (${APP_VERSION} < ${minVersionRequired}) — forcing update`
        );
        pendingRestartDelayMs = ADMIN_RESTART_DELAY_MS;
        check();
      }
    } catch {
      /* cloud offline */
    }
  }, 20000);
}

module.exports = { setupAutoUpdater, handleKioskCommand, compareSemver };
