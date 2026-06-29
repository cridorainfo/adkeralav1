const fs = require('fs');
const path = require('path');

/** Production cloud — baked into packaged bus PC builds when CI secret is unset. */
const PRODUCTION_CLOUD_URL = 'https://adkerala.com';
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
      process.env.VITE_CLOUD_URL || PRODUCTION_CLOUD_URL || FALLBACK_CLOUD_URL;
  }

  process.env.ADKERALA_DATA_ROOT = resolveWritableDataRoot(app);
}

function resolveWritableDataRoot(app) {
  if (process.env.ADKERALA_DATA_ROOT) return process.env.ADKERALA_DATA_ROOT;

  const besideExe =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'));

  if (isWritableDir(besideExe)) return besideExe;

  const userData = path.join(app.getPath('userData'), 'bus-data');
  fs.mkdirSync(userData, { recursive: true });
  return userData;
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
