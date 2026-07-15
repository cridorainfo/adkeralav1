#!/usr/bin/env node
/**
 * Build a hot-patch zip bundle from the current working tree — same directory scope
 * kiosk/hotpatchSupervisor.cjs expects to extract (see its extractPatch doc comment) and
 * the same scope test/hotpatchSupervisor.test.mjs's zipPatchDirs mirrors for tests.
 *
 * Usage:
 *   node scripts/build-hotpatch-bundle.mjs <version> <outputDir>
 *
 * Prints the output zip path and its sha256 (space-separated) on the last stdout line,
 * for a CI step to capture and pass to scripts/register-hotpatch.mjs.
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

const version = process.argv[2];
const outDir = process.argv[3] ?? 'release';

if (!version) {
  console.error('Usage: node scripts/build-hotpatch-bundle.mjs <version> [outputDir]');
  process.exit(1);
}

// Keep this list in sync with test/hotpatchSupervisor.test.mjs's PATCH_DIRS and
// kiosk/hotpatchSupervisor.cjs's extractPatch validation (server/prod.js + package.json
// must be present in the bundle).
const PATCH_DIRS = ['server', 'src/store', 'src/lib', 'shared', 'cloud/shared/hub'];

const repoRoot = process.cwd();
const zip = new AdmZip();
for (const rel of PATCH_DIRS) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    console.error(`Missing expected patch directory: ${rel}`);
    process.exit(1);
  }
  zip.addLocalFolder(abs, rel);
}
zip.addLocalFile(path.join(repoRoot, 'package.json'));

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `adkerala-hotpatch-${version}.zip`);
zip.writeZip(outFile);

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(outFile)).digest('hex');
console.log(`Built ${outFile} (${fs.statSync(outFile).size} bytes)`);
console.log(`${outFile} ${sha256}`);
