const fs = require('fs');
const path = require('path');

/** Human-facing domain — behind Cloudflare, fine for browsers but challenges/blocks
 *  non-browser clients (confirmed: Cloudflare returns 403 cf-mitigated:challenge to
 *  both curl and, by the same token, electron-updater/fetch traffic). */
const PRODUCTION_CLOUD_URL = 'https://adkerala.com';
/** Raw Railway URL — same backend, no Cloudflare in front. Used for all
 *  machine-to-machine bus-PC traffic (route/media sync, telemetry, update checks). */
const FALLBACK_CLOUD_URL = 'https://adkeralav1-production.up.railway.app';

/**
 * Set all environment defaults for a packaged bus PC so operators never
 * configure variables manually (no .bat, no system env).
 */
function applyPackagedDefaults(app) {
  process.env.ADKERALA_PACKAGED = '1';
  process.env.ADKERALA_APP_PATH = app.getAppPath();
  process.env.ADKERALA_LOCAL_ADMIN = '0';
  process.env.ADKERALA_HTTPS = process.env.ADKERALA_HTTPS ?? '1';

  if (!process.env.ADKERALA_CLOUD_URL) {
    process.env.ADKERALA_CLOUD_URL =
      process.env.VITE_CLOUD_URL || FALLBACK_CLOUD_URL || PRODUCTION_CLOUD_URL;
  }

  process.env.ADKERALA_DATA_ROOT = resolveWritableDataRoot(app);
}

/**
 * A genuine NSIS install (has "Uninstall *.exe" beside the exe) gets wiped and
 * recreated by the installer on every auto-update — including the bus's data
 * root, since it used to live "beside the exe" unconditionally. A true
 * portable copy (no uninstaller, per portable-template/INSTALL.txt) has no
 * such installer step, so it's safe to keep its data alongside the exe there.
 */
function hasNsisUninstaller(dir) {
  try {
    return fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f));
  } catch {
    return false;
  }
}

function resolveWritableDataRoot(app) {
  if (process.env.ADKERALA_DATA_ROOT) return process.env.ADKERALA_DATA_ROOT;

  const besideExe =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'));

  if (!hasNsisUninstaller(besideExe) && isWritableDir(besideExe)) return besideExe;

  const userData = path.join(app.getPath('userData'), 'bus-data');
  migrateBesideExeDataOnce(besideExe, userData);
  return userData;
}

/** One-time carry-over so upgrading an existing beside-exe install doesn't re-trigger a fleet claim. */
function migrateBesideExeDataOnce(besideExe, userData) {
  const alreadyMigrated = fs.existsSync(path.join(userData, 'adkerala.device.json'));
  const hasOldData = fs.existsSync(path.join(besideExe, 'adkerala.device.json'));
  fs.mkdirSync(userData, { recursive: true });
  if (alreadyMigrated || !hasOldData) return;

  try {
    for (const name of fs.readdirSync(besideExe)) {
      if (!/^(adkerala\.device\.json.*|db)$/i.test(name)) continue;
      fs.cpSync(path.join(besideExe, name), path.join(userData, name), { recursive: true });
    }
    console.log(`AdKerala: migrated bus data from ${besideExe} to ${userData} (update-safe location)`);
  } catch (err) {
    console.warn('AdKerala: data migration to update-safe location failed:', err?.message ?? err);
  }
}

function isWritableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.adkerala-write-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

module.exports = { applyPackagedDefaults, PRODUCTION_CLOUD_URL, FALLBACK_CLOUD_URL };
