/**
 * Hot-patch supervisor — applies server-code-only patches (server/, src/store/,
 * src/lib/, shared/) without a full NSIS reinstall/relaunch.
 *
 * Core guarantee: the currently-running/previously-working code is never mutated in
 * place. Each patch extracts into its own fresh, independent version directory under
 * <dataRoot>/hotpatch/versions/<version>/ (dataRoot is the same "update-safe" location
 * db/info.txt already lives in — see kiosk/installEnv.cjs — because appRoot itself gets
 * wiped and recreated by every full-app NSIS update). A tiny pointer file names which
 * version is active; switching versions is one atomic rename of that pointer, never a
 * bulk file copy/overwrite. A version is only ever pointed to after it has *already*
 * proven it can boot and answer a request on a scratch port — including at cold boot,
 * so a power loss mid-update can never leave the bus unable to start; worst case it
 * silently falls back to the last-known-good version.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { fork } = require('child_process');
const AdmZip = require('adm-zip');

const MAX_KEPT_VERSIONS = 3;
const MAX_FAILED_ATTEMPTS = 2;
const DEFAULT_SELFTEST_TIMEOUT_MS = 8000;

function hotpatchRoot(dataRoot) {
  return path.join(dataRoot, 'hotpatch');
}
function versionsDir(dataRoot) {
  return path.join(hotpatchRoot(dataRoot), 'versions');
}
function pointerFile(dataRoot) {
  return path.join(hotpatchRoot(dataRoot), 'current.json');
}
function failuresFile(dataRoot) {
  return path.join(hotpatchRoot(dataRoot), 'failures.json');
}
function nodeModulesLink(dataRoot) {
  return path.join(hotpatchRoot(dataRoot), 'node_modules');
}

function safeVersionName(version) {
  const clean = String(version ?? '').trim();
  if (!clean || !/^[a-zA-Z0-9._+-]+$/.test(clean)) {
    throw new Error(`Invalid hot-patch version name: ${JSON.stringify(version)}`);
  }
  return clean;
}

async function atomicWriteJson(filePath, data) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, filePath);
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Read the currently-committed pointer, or null if none/corrupt. */
async function readPointer(dataRoot) {
  const data = await readJsonSafe(pointerFile(dataRoot));
  return data?.version ? { version: String(data.version) } : null;
}

/** Atomically commit which version is active. */
async function writePointer(dataRoot, version) {
  await atomicWriteJson(pointerFile(dataRoot), {
    version: safeVersionName(version),
    appliedAt: new Date().toISOString(),
  });
}

async function clearPointer(dataRoot) {
  await fsp.rm(pointerFile(dataRoot), { force: true });
}

/** Absolute path to a given version's server/prod.js, or null if the dir doesn't look valid. */
function versionServerEntry(dataRoot, version) {
  return path.join(versionsDir(dataRoot), safeVersionName(version), 'server', 'prod.js');
}

function versionDirExists(dataRoot, version) {
  try {
    return fs.existsSync(versionServerEntry(dataRoot, version));
  } catch {
    return false;
  }
}

/**
 * Create/refresh a directory junction from <hotpatch>/node_modules to the real app's
 * node_modules. Hot patches never change npm dependencies (by design — see the plan),
 * so a single shared link is enough for every version directory: Node's module
 * resolution walks up from server/prod.js's own directory through versions/<v>/ and
 * versions/, and finds node_modules here regardless of which version is active.
 * Using a junction (not a symlink) means this needs no elevated Windows privileges.
 */
async function ensureNodeModulesLink(dataRoot, appRoot) {
  const linkPath = nodeModulesLink(dataRoot);
  const target = path.resolve(appRoot, 'node_modules');
  await fsp.mkdir(hotpatchRoot(dataRoot), { recursive: true });

  let existingTarget = null;
  try {
    existingTarget = await fsp.readlink(linkPath);
  } catch {
    /* doesn't exist or isn't a link — fine */
  }
  if (existingTarget && path.resolve(path.dirname(linkPath), existingTarget) === target) {
    return;
  }
  if (existingTarget) {
    await fsp.rm(linkPath, { force: true });
  }

  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fsp.symlink(target, linkPath, type);
}

/** SHA-256 of a buffer, hex-encoded. */
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract a patch zip into a fresh, independent version directory. Never touches any
 * other version or the live pointer — safe to call while the live server keeps running
 * on whatever version is currently active.
 */
async function extractPatch({ dataRoot, appRoot, version, zipBuffer, sha256 }) {
  const v = safeVersionName(version);
  if (sha256) {
    const actual = sha256Hex(zipBuffer);
    if (actual.toLowerCase() !== String(sha256).toLowerCase()) {
      throw new Error(`Hot patch ${v}: checksum mismatch (expected ${sha256}, got ${actual})`);
    }
  }

  await fsp.mkdir(versionsDir(dataRoot), { recursive: true });
  const staging = path.join(hotpatchRoot(dataRoot), `.staging-${process.pid}-${Date.now()}`);
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(staging, { recursive: true });

  try {
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(staging, true);

    const entryServerFile = path.join(staging, 'server', 'prod.js');
    if (!fs.existsSync(entryServerFile)) {
      throw new Error(`Hot patch ${v}: extracted bundle has no server/prod.js — refusing to apply`);
    }
    // package.json must ship inside the bundle (not synthesized here) — Node's "#hub/*"
    // subpath-imports resolution (see src/lib/fileStorage.js) requires a real package.json
    // with an "imports" field discoverable by walking up from the importing file, and the
    // extracted version directory has no other ancestor that could provide one.
    if (!fs.existsSync(path.join(staging, 'package.json'))) {
      throw new Error(`Hot patch ${v}: extracted bundle has no package.json — refusing to apply`);
    }

    const finalDir = path.join(versionsDir(dataRoot), v);
    await fsp.rm(finalDir, { recursive: true, force: true });
    await fsp.rename(staging, finalDir);
  } catch (err) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  await ensureNodeModulesLink(dataRoot, appRoot);
  return versionServerEntry(dataRoot, v);
}

/**
 * Boot a candidate version's server/prod.js on a scratch port against a throwaway
 * temp data root (never the live one), confirm it answers /api/network, then shut it
 * down. Runs as a genuinely separate process (kiosk/hotpatchSelfTestRunner.mjs) so a
 * broken candidate (syntax error, throw-on-import, infinite loop) can never affect the
 * live server or this supervisor process — worst case that child is killed on timeout.
 */
async function selfTestVersion({
  dataRoot,
  appRoot,
  version,
  timeoutMs = DEFAULT_SELFTEST_TIMEOUT_MS,
  forkModulePath = path.join(__dirname, 'hotpatchSelfTestRunner.mjs'),
}) {
  const serverEntry = versionServerEntry(dataRoot, version);
  if (!fs.existsSync(serverEntry)) {
    return { ok: false, reason: 'missing-server-entry' };
  }

  const scratchDataRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'adkerala-selftest-'));

  return new Promise((resolve) => {
    let settled = false;
    const child = fork(forkModulePath, [
      '--server', serverEntry,
      '--app-root', appRoot,
      '--data-root', scratchDataRoot,
    ], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      // ADKERALA_LOCAL_ADMIN=0: shouldStartLocalAdmin() defaults to true and would otherwise
      // spawn `npm install` + a whole second dev server for the cloud admin dashboard on every
      // self-test attempt — meant for local dev convenience, actively harmful here.
      env: { ...process.env, ADKERALA_HTTPS: '0', ADKERALA_LOCAL_ADMIN: '0' },
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      child.removeAllListeners();
      if (!child.killed) child.kill();
      fsp.rm(scratchDataRoot, { recursive: true, force: true }).catch(() => {});
      resolve(result);
    };

    const killTimer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);

    child.on('exit', (code) => {
      finish(code === 0 ? { ok: true } : { ok: false, reason: `exit-${code}` });
    });
    child.on('error', (err) => {
      finish({ ok: false, reason: `spawn-error: ${err.message}` });
    });
  });
}

async function readFailures(dataRoot) {
  return (await readJsonSafe(failuresFile(dataRoot))) ?? {};
}

async function recordFailedAttempt(dataRoot, version) {
  const v = safeVersionName(version);
  const failures = await readFailures(dataRoot);
  failures[v] = (failures[v] ?? 0) + 1;
  await atomicWriteJson(failuresFile(dataRoot), failures);
  return failures[v];
}

async function clearFailures(dataRoot, version) {
  const v = safeVersionName(version);
  const failures = await readFailures(dataRoot);
  if (v in failures) {
    delete failures[v];
    await atomicWriteJson(failuresFile(dataRoot), failures);
  }
}

async function hasExceededFailureCap(dataRoot, version) {
  const failures = await readFailures(dataRoot);
  return (failures[safeVersionName(version)] ?? 0) >= MAX_FAILED_ATTEMPTS;
}

/** Delete old version directories, keeping the active one plus the N most recent others. */
async function pruneOldVersions(dataRoot, keep = MAX_KEPT_VERSIONS) {
  const dir = versionsDir(dataRoot);
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const pointer = await readPointer(dataRoot);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const stat = await fsp.stat(full).catch(() => null);
    if (stat) candidates.push({ name: entry.name, mtimeMs: stat.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keepNames = new Set(candidates.slice(0, keep).map((c) => c.name));
  if (pointer?.version) keepNames.add(pointer.version);

  for (const c of candidates) {
    if (keepNames.has(c.name)) continue;
    await fsp.rm(path.join(dir, c.name), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Full apply flow for a downloaded, checksum-verified patch: extract → self-test on a
 * scratch port → commit the pointer only if the self-test passed → prune old versions.
 * Does NOT restart the live server — that's the caller's job (only kiosk/main.cjs holds
 * the live child process handle), since this module has no opinion on Electron lifecycle.
 */
async function applyPatch({ dataRoot, appRoot, version, zipBuffer, sha256, selfTestTimeoutMs }) {
  const v = safeVersionName(version);

  if (await hasExceededFailureCap(dataRoot, v)) {
    return { ok: false, reason: 'failure-cap-exceeded' };
  }

  try {
    await extractPatch({ dataRoot, appRoot, version: v, zipBuffer, sha256 });
  } catch (err) {
    await recordFailedAttempt(dataRoot, v);
    return { ok: false, reason: `extract-failed: ${err.message}` };
  }

  const test = await selfTestVersion({ dataRoot, appRoot, version: v, timeoutMs: selfTestTimeoutMs });
  if (!test.ok) {
    await recordFailedAttempt(dataRoot, v);
    await fsp.rm(path.join(versionsDir(dataRoot), v), { recursive: true, force: true }).catch(() => {});
    return { ok: false, reason: `selftest-failed: ${test.reason}` };
  }

  await writePointer(dataRoot, v);
  await clearFailures(dataRoot, v);
  await pruneOldVersions(dataRoot);
  return { ok: true, version: v };
}

/**
 * Resolve which server/prod.js to actually run — re-validated every call (including at
 * cold boot, not just live patches) so a pointer left behind by an interrupted update
 * can never be trusted blindly. Falls back to the base install's own server/prod.js
 * (immutable, guaranteed present by the installer) if the pointed-to version is
 * missing or fails its self-test.
 */
async function resolveActiveServerEntry({ dataRoot, appRoot, selfTestTimeoutMs }) {
  const baseEntry = path.join(appRoot, 'server', 'prod.js');
  const pointer = await readPointer(dataRoot);
  if (!pointer?.version) return { entry: baseEntry, version: 'base' };

  if (!versionDirExists(dataRoot, pointer.version)) {
    await clearPointer(dataRoot);
    return { entry: baseEntry, version: 'base' };
  }

  const test = await selfTestVersion({
    dataRoot,
    appRoot,
    version: pointer.version,
    timeoutMs: selfTestTimeoutMs,
  });
  if (!test.ok) {
    console.warn(
      `AdKerala hotpatch: pointed-to version ${pointer.version} failed re-validation (${test.reason}) — falling back to base`
    );
    await clearPointer(dataRoot);
    return { entry: baseEntry, version: 'base' };
  }

  return { entry: versionServerEntry(dataRoot, pointer.version), version: pointer.version };
}

module.exports = {
  hotpatchRoot,
  versionsDir,
  pointerFile,
  readPointer,
  writePointer,
  clearPointer,
  versionServerEntry,
  versionDirExists,
  ensureNodeModulesLink,
  sha256Hex,
  extractPatch,
  selfTestVersion,
  applyPatch,
  resolveActiveServerEntry,
  pruneOldVersions,
  recordFailedAttempt,
  clearFailures,
  hasExceededFailureCap,
  MAX_KEPT_VERSIONS,
  MAX_FAILED_ATTEMPTS,
};
