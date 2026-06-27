#!/usr/bin/env node
/**
 * Register PC + driver release metadata on the cloud admin after CI publishes artifacts.
 *
 * Usage:
 *   node scripts/register-release.mjs \
 *     --cloud-url https://your-app.up.railway.app \
 *     --admin-key YOUR_KEY \
 *     --version 1.0.0 \
 *     --pc-url https://github.com/org/repo/releases/download/v1.0.0/AdKeralaDisplay-Setup-1.0.0.exe \
 *     --driver-url https://github.com/org/repo/releases/download/v1.0.0/AdKeralaDriver-1.0.0.apk \
 *     --sha512 BASE64_SHA512_OPTIONAL
 */

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const cloudUrl = readArg('--cloud-url').replace(/\/+$/, '');
const adminKey = readArg('--admin-key');
const version = readArg('--version');
const pcUrl = readArg('--pc-url');
const driverUrl = readArg('--driver-url');
const sha512 = readArg('--sha512');
const releaseNotes = readArg('--notes') || `Release ${version}`;

if (!cloudUrl || !adminKey || !version) {
  console.error('Usage: node scripts/register-release.mjs --cloud-url URL --admin-key KEY --version X.Y.Z [--pc-url URL] [--driver-url URL] [--sha512 HASH]');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
  'X-Admin-Key': adminKey,
};

async function put(path, body) {
  const res = await fetch(`${cloudUrl}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP ${res.status} for ${path}`);
  }
  return json;
}

async function main() {
  const setMin = process.argv.includes('--set-min');
  if (setMin) {
    await put('/api/releases/min-versions', {
      minPcVersion: version,
      minDriverVersion: version,
    });
  }

  if (pcUrl) {
    await put('/api/releases/pc', {
      version,
      downloadUrl: pcUrl,
      sha512,
      releaseNotes,
    });
    console.log('Registered PC release', version);
  }

  if (driverUrl) {
    await put('/api/releases/driver', {
      version,
      downloadUrl: driverUrl,
      releaseNotes,
    });
    console.log('Registered driver release', version);
  }

  console.log('Done — buses with ADKERALA_CLOUD_URL will pick up PC updates automatically.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
