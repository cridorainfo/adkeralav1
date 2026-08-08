#!/usr/bin/env node
/**
 * Register an Android display release on the cloud admin, after you've built the APK yourself
 * in Android Studio (Build > Build Bundle(s)/APK(s) > Build APK(s) — no CI pipeline for this
 * yet, unlike PC's `npm run ship`) and uploaded it somewhere with a stable download URL (a
 * GitHub Release asset, cloud storage, etc.).
 *
 * Usage:
 *   node scripts/register-android-release.mjs \
 *     --cloud-url https://your-app.up.railway.app \
 *     --admin-key YOUR_KEY \
 *     --version 1.0.0 \
 *     --apk-url https://github.com/org/repo/releases/download/android-v1.0.0/AdKeralaDisplay-1.0.0.apk \
 *     --sha256 HEX_SHA256_OPTIONAL \
 *     --set-min   (optional — also raises minAndroidVersion to this version, forcing an
 *                  immediate silent install fleet-wide regardless of trip state; see
 *                  ANDROID-UPDATE.md)
 *
 * versionName in display/android/app/build.gradle must be bumped to match --version before
 * building the APK — AdKeralaUpdateChecker.java compares the installed PackageInfo.versionName
 * against whatever's registered here, not this script's --version alone.
 */

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const cloudUrl = readArg('--cloud-url').replace(/\/+$/, '');
const adminKey = readArg('--admin-key');
const version = readArg('--version');
const apkUrl = readArg('--apk-url');
const sha256 = readArg('--sha256');
const releaseNotes = readArg('--notes') || `Android release ${version}`;
const setMin = process.argv.includes('--set-min');

if (!cloudUrl || !adminKey || !version || !apkUrl) {
  console.error(
    'Usage: node scripts/register-android-release.mjs --cloud-url URL --admin-key KEY ' +
      '--version X.Y.Z --apk-url URL [--sha256 HEX] [--set-min]'
  );
  process.exit(1);
}

async function put(path, body) {
  const res = await fetch(`${cloudUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP ${res.status} for ${path}`);
  }
  return json;
}

async function main() {
  await put('/api/releases/android', { version, downloadUrl: apkUrl, sha256, releaseNotes });
  console.log('Registered Android release', version);

  if (setMin) {
    await put('/api/releases/min-versions', { minAndroidVersion: version });
    console.log(`minAndroidVersion raised to ${version} — enrolled devices update immediately.`);
  }

  console.log(
    'Done — Device-Owner-enrolled Android units check every 15 min (and once at boot) and ' +
      'install silently. Non-enrolled units never install automatically — see ANDROID-UPDATE.md.'
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
