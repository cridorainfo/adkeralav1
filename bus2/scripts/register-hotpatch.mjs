#!/usr/bin/env node
/**
 * Register a hot-patch bundle's metadata on the cloud admin after CI publishes it as a
 * GitHub Release asset. Mirrors scripts/register-release.mjs's PC-release registration,
 * just against the hot-patch-specific endpoint.
 *
 * Usage:
 *   node scripts/register-hotpatch.mjs \
 *     --cloud-url https://your-app.up.railway.app \
 *     --admin-key YOUR_KEY \
 *     --version 1.0.15.1 \
 *     --download-url https://github.com/org/repo/releases/download/hotpatch-v1.0.15.1/adkerala-hotpatch-1.0.15.1.zip \
 *     --sha256 HEX_DIGEST
 */

function readArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : '';
}

const cloudUrl = readArg('--cloud-url').replace(/\/+$/, '');
const adminKey = readArg('--admin-key');
const version = readArg('--version');
const downloadUrl = readArg('--download-url');
const sha256 = readArg('--sha256');
const releaseNotes = readArg('--notes') || `Hot patch ${version}`;

if (!cloudUrl || !adminKey || !version || !downloadUrl) {
  console.error(
    'Usage: node scripts/register-hotpatch.mjs --cloud-url URL --admin-key KEY --version X.Y.Z.N --download-url URL --sha256 HEX'
  );
  process.exit(1);
}

async function main() {
  const res = await fetch(`${cloudUrl}/api/releases/pc/hotpatch`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
    body: JSON.stringify({ version, downloadUrl, sha256, releaseNotes }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  console.log('Registered hot patch', version, '— buses will pick it up on their next 5s sync tick.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
