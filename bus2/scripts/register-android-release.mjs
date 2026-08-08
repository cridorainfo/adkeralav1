#!/usr/bin/env node
/**
 * Register an Android display release on the cloud admin, after building the APK(s) — either
 * via CI (release.yml's build-android job, which now produces one APK per ABI via build.gradle's
 * splits.abi block — see display/LIBNODE-SETUP.md) or manually in Android Studio (Build > Build
 * Bundle(s)/APK(s) > Build APK(s)) and uploading them somewhere with a stable download URL (a
 * GitHub Release asset, cloud storage, etc.).
 *
 * The fleet spans multiple chipsets (not just arm64), and a single universal APK bundling every
 * ABI's native libraries was ~3x the necessary download size for any one device — so releases
 * are now per-ABI variants (see cloud/releases.js's setAndroidRelease). Two ways to register:
 *
 * Directory mode (what CI uses — registers every ABI in one call):
 *   node scripts/register-android-release.mjs \
 *     --cloud-url https://your-app.up.railway.app \
 *     --admin-key YOUR_KEY \
 *     --version 1.0.18 \
 *     --apk-dir ./release-upload \
 *     --repo org/repo \
 *     --tag v1.0.18 \
 *     [--sha256]   (default: computed locally from each file's bytes — pass --no-sha256 to skip)
 *
 *   Scans --apk-dir for files matching AdKeralaDisplay-<version>-<abi>.apk (exactly what
 *   release.yml's "Rename APKs" step produces), computes each one's sha256 locally, and derives
 *   each download URL as https://github.com/<repo>/releases/download/<tag>/<filename>.
 *
 * Single-file mode (manual/one-off — e.g. registering just one device's test build):
 *   node scripts/register-android-release.mjs \
 *     --cloud-url https://your-app.up.railway.app \
 *     --admin-key YOUR_KEY \
 *     --version 1.0.18 \
 *     --apk-url https://github.com/org/repo/releases/download/v1.0.18/AdKeralaDisplay-1.0.18.apk \
 *     --sha256 HEX_SHA256_OPTIONAL \
 *     [--abi arm64-v8a]   (tags this build as that ABI's variant; omitted = flat/default only)
 *
 * Both modes accept:
 *   --set-min   (also raises minAndroidVersion to this version, forcing an immediate silent
 *                install fleet-wide regardless of trip state; see ANDROID-UPDATE.md)
 *
 * versionName in display/android/app/build.gradle must be bumped to match --version before
 * building the APK(s) — AdKeralaUpdateChecker.java compares the installed PackageInfo.versionName
 * against whatever's registered here, not this script's --version alone.
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

const KNOWN_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'];

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}
function hasFlag(name) {
  return process.argv.includes(name);
}

const cloudUrl = readArg('--cloud-url').replace(/\/+$/, '');
const adminKey = readArg('--admin-key');
const version = readArg('--version');
const releaseNotes = readArg('--notes') || `Android release ${version}`;
const setMin = hasFlag('--set-min');

const apkDir = readArg('--apk-dir');
const repo = readArg('--repo');
const tag = readArg('--tag');

const apkUrl = readArg('--apk-url');
const singleSha256 = readArg('--sha256');
const singleAbi = readArg('--abi');

const dirMode = Boolean(apkDir);

if (!cloudUrl || !adminKey || !version || (dirMode ? !repo || !tag : !apkUrl)) {
  console.error(
    'Usage (directory mode):\n' +
      '  node scripts/register-android-release.mjs --cloud-url URL --admin-key KEY ' +
      '--version X.Y.Z --apk-dir DIR --repo OWNER/REPO --tag vX.Y.Z [--set-min]\n' +
      'Usage (single-file mode):\n' +
      '  node scripts/register-android-release.mjs --cloud-url URL --admin-key KEY ' +
      '--version X.Y.Z --apk-url URL [--sha256 HEX] [--abi ABI] [--set-min]'
  );
  process.exit(1);
}

function sha256OfFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Matches release.yml's "Rename APKs" output: AdKeralaDisplay-<version>-<abi>.apk. Files that
 * don't match a known ABI suffix are skipped with a warning rather than silently dropped —
 * a naming drift between this script and the CI rename step should be loud, not invisible. */
function discoverVariants(dir, expectedVersion) {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.apk'));
  const variants = {};
  // The ABI itself contains hyphens (arm64-v8a, armeabi-v7a), so a generic "version-abi" split
  // can't tell the two apart with a plain greedy/character-class regex — a naive attempt here
  // matched "1.0.18-arm64" as the version and "v8a" as the ABI. Anchoring group 2 to the exact
  // known ABI strings (not a generic charclass) makes the split unambiguous regardless of how
  // many hyphens the version itself has.
  const abiAlternation = KNOWN_ABIS.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const filePattern = new RegExp(`^AdKeralaDisplay-(.+)-(${abiAlternation})\\.apk$`);
  for (const file of files) {
    const match = file.match(filePattern);
    if (!match) {
      console.warn(`Skipping ${file} — doesn't match AdKeralaDisplay-<version>-<abi>.apk (known ABIs: ${KNOWN_ABIS.join(', ')})`);
      continue;
    }
    const [, fileVersion, abi] = match;
    if (fileVersion !== expectedVersion) {
      console.warn(`Skipping ${file} — version ${fileVersion} doesn't match --version ${expectedVersion}`);
      continue;
    }
    const fullPath = path.join(dir, file);
    variants[abi] = {
      downloadUrl: `https://github.com/${repo}/releases/download/${tag}/${file}`,
      sha256: sha256OfFile(fullPath),
      size: readFileSync(fullPath).length,
    };
  }
  return variants;
}

async function put(apiPath, body) {
  const res = await fetch(`${cloudUrl}${apiPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP ${res.status} for ${apiPath}`);
  }
  return json;
}

async function main() {
  let body;
  if (dirMode) {
    const variants = discoverVariants(apkDir, version);
    const abis = Object.keys(variants);
    if (!abis.length) {
      throw new Error(`No matching APKs found in ${apkDir} for version ${version}`);
    }
    console.log(`Found ${abis.length} ABI variant(s): ${abis.join(', ')}`);
    body = { version, variants, releaseNotes };
  } else {
    body = {
      version,
      downloadUrl: apkUrl,
      sha256: singleSha256,
      releaseNotes,
      ...(singleAbi ? { variants: { [singleAbi]: { downloadUrl: apkUrl, sha256: singleSha256 } } } : {}),
    };
  }

  await put('/api/releases/android', body);
  console.log('Registered Android release', version);

  if (setMin) {
    await put('/api/releases/min-versions', { minAndroidVersion: version });
    console.log(`minAndroidVersion raised to ${version} — enrolled devices update immediately.`);
  }

  console.log(
    'Done — Device-Owner-enrolled Android units check every 15 min (and once at boot), pick the ' +
      'build matching their own chipset, and install silently. Non-enrolled units never install ' +
      'automatically — see ANDROID-UPDATE.md.'
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
