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
//
// A FUNCTION, not a top-level const, and this matters: androidMain.js sets
// ADKERALA_APP_VERSION_OVERRIDE *after* its own `import { startBusServer } from './prod.js'` —
// but ES module imports are hoisted and fully evaluated before any of the importing module's own
// top-level code runs, so a plain `const APP_VERSION = process.env...` here would have already
// locked in `pkg.version` (that '0.0.0' placeholder) by the time androidMain.js's override line
// executed, permanently — no amount of setting the env var afterward would change an already-
// evaluated const. This was a real bug (2026-08-12 field case: every Android device's fleet
// telemetry reported appVersion '0.0.0' regardless of what was actually installed, because of
// exactly this ordering). A function defers the process.env read to call time, i.e. every time
// buildTelemetry() runs — long after androidMain.js's top-level code has finished — same fix
// shape as cloudSync.js's `platform` field, which reads process.env.ADKERALA_PLATFORM inside its
// own function body for the same reason and never had this bug.
export function getAppVersion() {
  return process.env.ADKERALA_APP_VERSION_OVERRIDE || pkg.version;
}

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
