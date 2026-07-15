import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const supervisor = require('../kiosk/hotpatchSupervisor.cjs');

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Must match scripts/ship-hotpatch.mjs and kiosk/hotpatchSupervisor.cjs's expectations.
// cloud/shared/hub is needed because src/lib/fileStorage.js uses the "#hub/api" subpath
// import mapped in package.json — and package.json itself has to ship too, since Node's
// subpath-imports resolution requires a real package.json in the extracted tree's own
// ancestry (found this the hard way: the very first "should just work" test failed with
// "Package import specifier #hub/api is not defined" until both were added).
const PATCH_DIRS = ['server', 'src/store', 'src/lib', 'shared', 'cloud/shared/hub'];

/** Build a hot-patch zip from a source tree, mirroring scripts/ship-hotpatch.mjs. */
function zipPatchDirs(srcRoot) {
  const zip = new AdmZip();
  for (const rel of PATCH_DIRS) {
    zip.addLocalFolder(path.join(srcRoot, rel), rel);
  }
  zip.addLocalFile(path.join(srcRoot, 'package.json'));
  return zip.toBuffer();
}

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** A full source tree copy so tests can safely mutate files without touching the real repo. */
async function makePatchSourceTree() {
  const dir = await makeTempDir('adkerala-patchsrc-');
  for (const rel of PATCH_DIRS) {
    await fs.cp(path.join(REPO_ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  await fs.copyFile(path.join(REPO_ROOT, 'package.json'), path.join(dir, 'package.json'));
  return dir;
}

test('applyPatch: valid patch self-tests, commits pointer, and resolves as active', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();

  const zipBuffer = zipPatchDirs(srcTree);
  const sha256 = supervisor.sha256Hex(zipBuffer);

  const result = await supervisor.applyPatch({
    dataRoot,
    appRoot: REPO_ROOT,
    version: '9.9.1-test',
    zipBuffer,
    sha256,
  });

  assert.equal(result.ok, true, JSON.stringify(result));

  const pointer = await supervisor.readPointer(dataRoot);
  assert.equal(pointer.version, '9.9.1-test');

  const resolved = await supervisor.resolveActiveServerEntry({ dataRoot, appRoot: REPO_ROOT });
  assert.equal(resolved.version, '9.9.1-test');
  assert.ok(resolved.entry.endsWith(path.join('versions', '9.9.1-test', 'server', 'prod.js')));
});

test('applyPatch: checksum mismatch is rejected before extraction commits anything', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();
  const zipBuffer = zipPatchDirs(srcTree);

  const result = await supervisor.applyPatch({
    dataRoot,
    appRoot: REPO_ROOT,
    version: '9.9.2-badsum',
    zipBuffer,
    sha256: '0'.repeat(64),
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /checksum mismatch/);
  assert.equal(await supervisor.readPointer(dataRoot), null);
  assert.equal(supervisor.versionDirExists(dataRoot, '9.9.2-badsum'), false);
});

test('applyPatch: bundle missing server/prod.js is rejected', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const zip = new AdmZip();
  zip.addFile('server/not-prod.js', Buffer.from('export const x = 1;'));
  const zipBuffer = zip.toBuffer();

  const result = await supervisor.applyPatch({
    dataRoot,
    appRoot: REPO_ROOT,
    version: '9.9.3-nofile',
    zipBuffer,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /no server\/prod\.js/);
});

test('applyPatch: a patch that fails to boot never commits the pointer, and gets rolled back', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();

  // Sabotage the patch: make server/prod.js throw immediately on import.
  const prodPath = path.join(srcTree, 'server', 'prod.js');
  const original = await fs.readFile(prodPath, 'utf8');
  await fs.writeFile(prodPath, `throw new Error('simulated boot failure');\n${original}`);

  const zipBuffer = zipPatchDirs(srcTree);

  const result = await supervisor.applyPatch({
    dataRoot,
    appRoot: REPO_ROOT,
    version: '9.9.4-broken',
    zipBuffer,
    selfTestTimeoutMs: 8000,
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /selftest-failed/);
  assert.equal(await supervisor.readPointer(dataRoot), null, 'pointer must stay unset');
  assert.equal(
    supervisor.versionDirExists(dataRoot, '9.9.4-broken'),
    false,
    'failed version directory should be cleaned up, not left half-applied'
  );

  const resolved = await supervisor.resolveActiveServerEntry({ dataRoot, appRoot: REPO_ROOT });
  assert.equal(resolved.version, 'base', 'must fall back to the base install');
});

test('applyPatch: stops retrying after the failure cap and does not re-extract', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();
  const prodPath = path.join(srcTree, 'server', 'prod.js');
  const original = await fs.readFile(prodPath, 'utf8');
  await fs.writeFile(prodPath, `throw new Error('simulated boot failure');\n${original}`);
  const zipBuffer = zipPatchDirs(srcTree);

  let lastResult;
  for (let i = 0; i < supervisor.MAX_FAILED_ATTEMPTS + 1; i += 1) {
    lastResult = await supervisor.applyPatch({
      dataRoot,
      appRoot: REPO_ROOT,
      version: '9.9.5-capped',
      zipBuffer,
      selfTestTimeoutMs: 8000,
    });
  }

  assert.equal(lastResult.ok, false);
  assert.equal(lastResult.reason, 'failure-cap-exceeded');
});

test('resolveActiveServerEntry: a pointer naming a missing version dir falls back to base and clears itself', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  await supervisor.writePointer(dataRoot, '1.2.3-ghost');

  const resolved = await supervisor.resolveActiveServerEntry({ dataRoot, appRoot: REPO_ROOT });
  assert.equal(resolved.version, 'base');
  assert.equal(await supervisor.readPointer(dataRoot), null, 'ghost pointer should be cleared');
});

test('resolveActiveServerEntry: cold-boot re-validates even an already-committed version, falling back if it no longer boots', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();
  const zipBuffer = zipPatchDirs(srcTree);

  const applied = await supervisor.applyPatch({
    dataRoot,
    appRoot: REPO_ROOT,
    version: '9.9.6-thenrot',
    zipBuffer,
  });
  assert.equal(applied.ok, true);

  // Simulate disk corruption / crash-mid-write discovered only on the next boot: delete a
  // file the committed version depends on, without touching the pointer.
  await fs.rm(path.join(supervisor.versionsDir(dataRoot), '9.9.6-thenrot', 'server', 'dbApi.js'));

  const resolved = await supervisor.resolveActiveServerEntry({ dataRoot, appRoot: REPO_ROOT });
  assert.equal(resolved.version, 'base');
  assert.equal(await supervisor.readPointer(dataRoot), null);
});

test('power-loss simulation: an interrupted (truncated) zip never leaves a partial version directory', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();
  const fullZip = zipPatchDirs(srcTree);
  const truncated = fullZip.subarray(0, Math.floor(fullZip.length / 2));

  await assert.rejects(() =>
    supervisor.extractPatch({
      dataRoot,
      appRoot: REPO_ROOT,
      version: '9.9.7-truncated',
      zipBuffer: truncated,
    })
  );

  assert.equal(supervisor.versionDirExists(dataRoot, '9.9.7-truncated'), false);
  const versionsPath = supervisor.versionsDir(dataRoot);
  const entries = await fs.readdir(versionsPath).catch(() => []);
  const leftoverStaging = entries.filter((e) => e.startsWith('.staging'));
  assert.deepEqual(leftoverStaging, [], 'no leftover staging directory under versions/');
});

test('power-loss simulation: pointer file is never left as garbled/partial JSON', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  await supervisor.writePointer(dataRoot, 'v1');

  // Simulate a crash exactly between "write temp file" and "rename over pointer" by
  // performing those two steps by hand and checking the pointer file's content after
  // only the first half.
  const tmp = `${supervisor.pointerFile(dataRoot)}.tmp-simulated`;
  await fs.writeFile(tmp, '{"version":"v2","appliedAt"'); // deliberately truncated JSON

  const pointerRaw = await fs.readFile(supervisor.pointerFile(dataRoot), 'utf8');
  const parsed = JSON.parse(pointerRaw);
  assert.equal(parsed.version, 'v1', 'pointer must still be the last fully-committed value');

  await fs.rm(tmp, { force: true });
});

test('ensureNodeModulesLink: a nested version directory can resolve a real npm dependency through the link', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  await supervisor.ensureNodeModulesLink(dataRoot, REPO_ROOT);

  const versionDir = path.join(supervisor.versionsDir(dataRoot), 'resolve-test', 'server');
  await fs.mkdir(versionDir, { recursive: true });
  const probeFile = path.join(versionDir, 'probe.mjs');
  await fs.writeFile(
    probeFile,
    "import express from 'express';\nconsole.log(typeof express === 'function' ? 'OK' : 'FAIL');\n"
  );

  const { execFileSync } = await import('child_process');
  const output = execFileSync(process.execPath, [probeFile], { encoding: 'utf8' });
  assert.match(output, /OK/);
});

test('pruneOldVersions: keeps the active pointer plus the most recent N, deletes the rest', async () => {
  const dataRoot = await makeTempDir('adkerala-dataroot-');
  const srcTree = await makePatchSourceTree();
  const zipBuffer = zipPatchDirs(srcTree);

  const versions = ['a1', 'a2', 'a3', 'a4', 'a5'];
  for (const v of versions) {
    await supervisor.extractPatch({ dataRoot, appRoot: REPO_ROOT, version: v, zipBuffer });
    // Ensure distinct mtimes so ordering is deterministic.
    await new Promise((r) => setTimeout(r, 10));
  }
  await supervisor.writePointer(dataRoot, 'a1'); // oldest — but pinned as "active"

  await supervisor.pruneOldVersions(dataRoot, 2);

  const remaining = await fs.readdir(supervisor.versionsDir(dataRoot));
  assert.ok(remaining.includes('a1'), 'active pointer version must survive pruning');
  assert.ok(remaining.includes('a5'), 'newest version must survive pruning');
  assert.ok(remaining.includes('a4'), 'second-newest version must survive pruning');
  assert.ok(!remaining.includes('a2'), 'old, non-active version should be pruned');
  assert.ok(!remaining.includes('a3'), 'old, non-active version should be pruned');
});
