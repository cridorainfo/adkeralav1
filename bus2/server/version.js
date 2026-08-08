import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// On Android, this file's own package.json is scripts/build-android-node-bundle.mjs's generated
// bundle manifest (version '0.0.0' — the embedded server bundle isn't itself separately
// versioned/update-checked the way PC's hot-patch is; see server/androidMain.js) — not the real
// installed APK version, which only Android's PackageManager actually knows. androidMain.js sets
// this override from the config AdKeralaNodeRunner.java writes (PackageInfo.versionName) so
// telemetry (server/cloudSync.js's buildTelemetry) reports the real Android app version instead
// of a meaningless placeholder.
export const APP_VERSION = process.env.ADKERALA_APP_VERSION_OVERRIDE || pkg.version;

export function compareSemver(a, b) {
  const pa = String(a ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  const pb = String(b ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

export function isOlderVersion(current, minimum) {
  return compareSemver(current, minimum) < 0;
}
