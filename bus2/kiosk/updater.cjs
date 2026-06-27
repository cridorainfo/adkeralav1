const { autoUpdater } = require('electron-updater');
const { APP_VERSION } = require('./version.cjs');

const CHECK_INTERVAL_MS = Number(process.env.ADKERALA_UPDATE_INTERVAL_MS ?? 6 * 60 * 60 * 1000);

function getCloudUrl() {
  return (process.env.ADKERALA_CLOUD_URL ?? '').replace(/\/+$/, '');
}

/** Configure electron-updater to pull latest.yml from the cloud admin server. */
function setupAutoUpdater() {
  const cloudUrl = getCloudUrl();
  if (!cloudUrl) {
    console.log('AdKerala updater: disabled (set ADKERALA_CLOUD_URL)');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.setFeedURL({
    provider: 'generic',
    url: `${cloudUrl}/api/releases/pc`,
  });

  autoUpdater.on('checking-for-update', () => {
    console.log('AdKerala updater: checking…', `(current v${APP_VERSION})`);
  });

  autoUpdater.on('update-available', (info) => {
    console.log('AdKerala updater: update available →', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('AdKerala updater: up to date');
  });

  autoUpdater.on('download-progress', (progress) => {
    const pct = Math.round(progress.percent ?? 0);
    if (pct % 25 === 0) console.log(`AdKerala updater: download ${pct}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('AdKerala updater: downloaded v' + info.version + ' — installs on quit');
  });

  autoUpdater.on('error', (err) => {
    console.warn('AdKerala updater:', err?.message ?? err);
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
      const min = json?.minVersion;
      if (min && compareSemver(APP_VERSION, min) < 0) {
        console.warn(`AdKerala updater: below minimum PC version (${APP_VERSION} < ${min})`);
      }
    } catch {
      /* cloud offline */
    }
  }, 20000);
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

module.exports = { setupAutoUpdater };
