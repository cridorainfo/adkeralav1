const { autoUpdater } = require('electron-updater');
const { APP_VERSION } = require('./version.cjs');

const CHECK_INTERVAL_MS = Number(process.env.ADKERALA_UPDATE_INTERVAL_MS ?? 15 * 60 * 1000);
const RESTART_DELAY_MS = Number(process.env.ADKERALA_UPDATE_RESTART_DELAY_MS ?? 3 * 60 * 1000);
const ADMIN_RESTART_DELAY_MS = Number(process.env.ADKERALA_UPDATE_ADMIN_DELAY_MS ?? 60 * 1000);
const BOOT_CHECK_TIMEOUT_MS = Number(process.env.ADKERALA_UPDATE_BOOT_TIMEOUT_MS ?? 8000);

let getMainWindow = () => null;
let setAllowQuit = () => {};
let restartTimer = null;
let countdownTimer = null;
let updateDownloaded = false;
let pendingVersion = null;
let pendingRestartDelayMs = RESTART_DELAY_MS;
let minVersionRequired = null;
let configured = false;

// True only while checkForUpdatesAtBoot() is waiting on a check result, before
// the kiosk window exists — lets onUpdateDownloaded tell "found at boot" apart
// from "found mid-session" without threading state through electron-updater.
let awaitingBootDecision = false;
let resolveBootCheck = null;

// Set right before a check that must apply immediately (admin push, forced
// minimum-version upgrade) — anything else discovered mid-session is deferred
// to the next boot instead of interrupting the passenger display.
let forceImmediateInstall = false;

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

/** Wakes up a pending checkForUpdatesAtBoot() call (found nothing / error / timeout). */
function settleBootCheck() {
  resolveBootCheck?.();
}

function onUpdateDownloaded(info) {
  updateDownloaded = true;
  pendingVersion = info?.version ?? null;

  if (awaitingBootDecision) {
    // Fresh launch, kiosk window not shown yet — nothing to interrupt.
    console.log('AdKerala updater: v' + pendingVersion + ' ready at boot — installing now');
    awaitingBootDecision = false;
    performInstall();
    return;
  }

  if (forceImmediateInstall) {
    console.log('AdKerala updater: downloaded v' + pendingVersion + ' — restart scheduled');
    scheduleInstall(pendingRestartDelayMs, 'update');
    pendingRestartDelayMs = RESTART_DELAY_MS;
    forceImmediateInstall = false;
    return;
  }

  // Found during a normal background poll while the bus is in service — don't
  // interrupt the passenger display. It installs automatically at next power-on
  // via checkForUpdatesAtBoot().
  console.log('AdKerala updater: downloaded v' + pendingVersion + ' — will install at next boot');
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
  forceImmediateInstall = true;
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn('AdKerala updater check failed:', err?.message ?? err);
  });
}

function handleKioskCommand(type, payload) {
  if (type === 'APPLY_UPDATE') {
    handleAdminPushUpdate(payload);
  }
}

/** Configure electron-updater's feed + event listeners. Call once, before checkForUpdatesAtBoot(). */
function configureAutoUpdater(deps = {}) {
  getMainWindow = deps.getMainWindow ?? getMainWindow;
  setAllowQuit = deps.setAllowQuit ?? setAllowQuit;

  if (configured) return true;

  const cloudUrl = getCloudUrl();
  if (!cloudUrl) {
    console.log('AdKerala updater: disabled (set ADKERALA_CLOUD_URL)');
    return false;
  }
  configured = true;

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
    settleBootCheck();
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
    settleBootCheck();
  });

  return true;
}

/**
 * Runs once at launch, before the kiosk window is created. If an update is
 * already fully downloaded and verified from a previous session, installs it
 * immediately — safe because nothing is on screen yet, so power-on is when
 * updates actually land. Otherwise resolves quickly (bounded by timeoutMs) so
 * a slow or absent network right at ignition never delays the kiosk from
 * showing; any update found keeps downloading in the background for next boot.
 */
function checkForUpdatesAtBoot(timeoutMs = BOOT_CHECK_TIMEOUT_MS) {
  if (!configured) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      awaitingBootDecision = false;
      resolveBootCheck = null;
      resolve();
    };

    awaitingBootDecision = true;
    resolveBootCheck = finish;
    timer = setTimeout(finish, timeoutMs);

    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('AdKerala updater boot check failed:', err?.message ?? err);
      finish();
    });
  });
}

/** Periodic background checks + forced-minimum-version enforcement. Call once, after the boot check. */
function startPeriodicUpdateChecks() {
  if (!configured) return;

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('AdKerala updater check failed:', err?.message ?? err);
    });
  };

  setInterval(check, CHECK_INTERVAL_MS);

  setTimeout(async () => {
    try {
      const res = await fetch(`${getCloudUrl()}/api/releases/pc/latest`);
      const json = await res.json();
      minVersionRequired = json?.minVersion ?? null;
      if (minVersionRequired && compareSemver(APP_VERSION, minVersionRequired) < 0) {
        console.warn(
          `AdKerala updater: below minimum PC version (${APP_VERSION} < ${minVersionRequired}) — forcing update`
        );
        pendingRestartDelayMs = ADMIN_RESTART_DELAY_MS;
        forceImmediateInstall = true;
        check();
      }
    } catch {
      /* cloud offline */
    }
  }, 20000);
}

module.exports = {
  configureAutoUpdater,
  checkForUpdatesAtBoot,
  startPeriodicUpdateChecks,
  handleKioskCommand,
  compareSemver,
};
