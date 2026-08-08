#!/usr/bin/env node
/**
 * Package the local server (the same code the Electron kiosk app runs — see server/prod.js)
 * plus the already-built SPA (dist/) into a nodejs-mobile-android "nodejs-project" bundle, for
 * the Android display app to embed and run in-process (see server/androidMain.js and
 * display/android/app/src/main/java/com/adkerala/display/AdKeralaNodeService.java).
 *
 * Usage:
 *   npm run build            # produces dist/ — required first
 *   node scripts/build-android-node-bundle.mjs [outputDir]
 *
 * Default outputDir: display/android/app/src/main/assets/nodejs-project
 *
 * Scope matches scripts/build-hotpatch-bundle.mjs's PATCH_DIRS exactly — the real server-side
 * import graph. server/*.js reaches well beyond its own directory: dbApi.js, hubSessions.js,
 * driveApi.js, stateMerge.js, cloudCommands.js, cloudSync.js, stopAudioReconcile.js, and
 * phraseAudioReconcile.js all import plain-data helpers from ../src/store/*.js and
 * ../src/lib/*.js (busStore.js, driveActions.js, busProfileMerge.js, tripMerge.js,
 * audioFragments.js) — these are shared between the client bundle (compiled into dist/ already)
 * and the server; the server needs its own copy alongside server/, not the compiled-away
 * version. Confirmed by actually running this bundle with plain `node` before ever touching
 * Android/Gradle — an earlier version of this script omitted src/store + src/lib and failed
 * immediately with ERR_MODULE_NOT_FOUND on stopAudioReconcile.js's import.
 *
 * The bundled package.json intentionally lists only `express` + `selfsigned` as dependencies —
 * everything else server/*.js touches is a Node core module. `sharp` is deliberately excluded:
 * it has no Android-arm prebuild, and server/imageProcess.js already dynamic-imports it behind a
 * try/catch that falls back to the original file when it's unavailable (see that file's comment).
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const repoRoot = process.cwd();
const outDir = path.resolve(repoRoot, process.argv[2] ?? 'display/android/app/src/main/assets/nodejs-project');

const distDir = path.join(repoRoot, 'dist');
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('dist/ is missing or incomplete — run `npm run build` first.');
  process.exit(1);
}

const COPY_DIRS = ['server', 'src/store', 'src/lib', 'shared', 'cloud/shared/hub'];

console.log(`Building Android node bundle -> ${outDir}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

for (const rel of COPY_DIRS) {
  const src = path.join(repoRoot, rel);
  if (!fs.existsSync(src)) {
    console.error(`Missing expected source directory: ${rel}`);
    process.exit(1);
  }
  fs.cpSync(src, path.join(outDir, rel), { recursive: true });
}

fs.cpSync(distDir, path.join(outDir, 'dist'), { recursive: true });

// server/*.js reaches src/lib and cloud/shared/hub through the '#hub/*' subpath-imports map
// (src/lib/fileStorage.js imports '#hub/api', etc.) — that map only exists because it's
// declared in package.json's own `imports` field (Node's ESM resolver reads it from *this*
// package.json, not the repo root's). Confirmed by actually running the bundle: an earlier
// version of this script omitted it and failed immediately with ERR_PACKAGE_IMPORT_NOT_DEFINED.
const rootPackageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

const bundlePackageJson = {
  name: 'adkerala-android-node-bundle',
  private: true,
  version: '0.0.0',
  type: 'module',
  main: 'server/androidMain.js',
  imports: rootPackageJson.imports,
  dependencies: {
    express: '^4.21.2',
    selfsigned: '^5.5.0',
  },
};
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(bundlePackageJson, null, 2) + '\n'
);

console.log('Installing production dependencies inside the bundle...');
execSync('npm install --omit=dev --omit=optional --no-audit --no-fund', {
  cwd: outDir,
  stdio: 'inherit',
});

console.log(`Android node bundle ready at ${outDir}`);
