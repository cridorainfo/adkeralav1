import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { existsSync } from 'fs';
import { getDbPaths, readInfoFile } from './dbApi.js';
import { collectAdMediaFromState, collectAudioMediaFromState } from './cloudCommands.js';

const MEDIA_CATEGORIES = new Set(['ads', 'banners', 'announcements', 'stops']);
const MEDIA_CATEGORY_LIST = [...MEDIA_CATEGORIES];

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';

function authHeaders(creds = {}) {
  return {
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
  };
}

// Every other outbound cloud call in this app (see cloudSync.js's cloudTimeoutSignal) learned
// the hard way that a fetch() with no timeout can hang forever on a flaky bus hotspot — this
// download loop had the same gap. A single stuck media download used to be able to wedge here
// indefinitely, and since a fresh sync tick fires every 5s regardless, each stuck tick left one
// more hung fetch running in the background.
const MEDIA_FETCH_TIMEOUT_MS = 20000;
function mediaTimeoutSignal(ms = MEDIA_FETCH_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/** Download missing media files from cloud admin into db/media/ (offline-first bus storage). */
export async function syncCloudMedia(root, relativePaths, creds = {}) {
  const cloudUrl = (creds.cloudUrl ?? process.env.ADKERALA_CLOUD_URL ?? '').replace(/\/+$/, '');
  if (!cloudUrl || !relativePaths?.length) return 0;

  const { mediaDir } = getDbPaths(root);
  let downloaded = 0;

  for (const relPath of relativePaths) {
    if (!relPath || relPath.includes('..')) continue;
    const category = relPath.split('/')[0];
    if (!MEDIA_CATEGORIES.has(category)) continue;

    const localFile = path.join(mediaDir, relPath);
    if (existsSync(localFile)) continue;

    // Download to a per-attempt temp file and rename into place only once the full body has
    // landed. Plain writeFile(localFile) would let a crash/kill mid-write (or a partial body
    // under a flaky connection) leave a truncated file behind — existsSync() above would then
    // treat that truncated file as "already downloaded" forever, permanently and silently
    // breaking playback for exactly that clip (same failure shape as audio that never syncs).
    const tmpFile = `${localFile}.download-${process.pid}-${Date.now()}.tmp`;
    try {
      const res = await fetch(`${cloudUrl}/api/media/${relPath}`, {
        headers: authHeaders(creds),
        signal: mediaTimeoutSignal(),
      });
      if (!res.ok) {
        console.warn('AdKerala media sync: download failed', relPath, res.status);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await fs.writeFile(tmpFile, buffer);
      await fs.rename(tmpFile, localFile);
      downloaded += 1;
      console.log('AdKerala media sync: saved', relPath);
    } catch (err) {
      console.warn('AdKerala media sync:', relPath, err.message);
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  return downloaded;
}

/**
 * Download an arbitrary absolute URL (not the bus's own /api/media/ scoped path — used for
 * hot-patch bundles, which are hosted as GitHub Release assets rather than cloud-admin media)
 * straight to a destination file, verifying a sha256 checksum before it's trusted. Same
 * timeout + atomic temp-file-then-rename pattern as syncCloudMedia above, for the same
 * reason: a crash/kill mid-write must never leave a truncated file mistaken for complete.
 */
export async function downloadToFile(url, destPath, { sha256, timeoutMs, headers = {} } = {}) {
  const res = await fetch(url, { headers, signal: mediaTimeoutSignal(timeoutMs) });
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status} for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  if (sha256) {
    const actual = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actual.toLowerCase() !== String(sha256).toLowerCase()) {
      throw new Error(`checksum mismatch for ${url} (expected ${sha256}, got ${actual})`);
    }
  }

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  const tmpFile = `${destPath}.download-${process.pid}-${Date.now()}.tmp`;
  await fs.writeFile(tmpFile, buffer);
  await fs.rename(tmpFile, destPath);
  return destPath;
}

// Grace period before an unreferenced file is considered "orphaned" rather than just
// mid-flight (e.g. downloaded but the state write that references it hasn't landed yet,
// or a crash happened between the two). Anything older than this with no reference anywhere
// in current state is safe to remove.
const GC_GRACE_MS = 10 * 60 * 1000;

/**
 * Defense-in-depth sweep: delete any file under db/media/<category>/ that isn't referenced
 * anywhere in the current bus state (ads, banner ads, stop audio, phrase audio). Every sync
 * path already deletes its own removed files as it goes (see deleteLocalMediaFiles calls in
 * cloudSync.js), but this catches drift from any edge case those miss — a crash mid-write, a
 * partially-applied command, a manual edit — so "no old files left on the bus" holds even in
 * cases no single sync function could have anticipated.
 */
export async function sweepOrphanedMedia(root) {
  const { mediaDir } = getDbPaths(root);
  const state = (await readInfoFile(root)) ?? {};
  const referenced = new Set([
    ...collectAdMediaFromState(state),
    ...collectAudioMediaFromState(state),
  ]);

  let removed = 0;
  for (const category of MEDIA_CATEGORY_LIST) {
    const dir = path.join(mediaDir, category);
    if (!existsSync(dir)) continue;

    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      const relPath = `${category}/${file}`;
      if (referenced.has(relPath)) continue;

      const fullPath = path.join(dir, file);
      try {
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        if (Date.now() - stat.mtimeMs < GC_GRACE_MS) continue; // still within grace period
        await fs.unlink(fullPath);
        removed += 1;
        console.log('AdKerala media GC: removed orphaned file', relPath);
      } catch {
        /* ignore — file may have been removed/replaced concurrently */
      }
    }
  }

  return removed;
}

const GC_INTERVAL_MS = Number(process.env.ADKERALA_MEDIA_GC_INTERVAL_MS ?? 30 * 60 * 1000);
const GC_INITIAL_DELAY_MS = 2 * 60 * 1000;

/** Periodic background sweep — safe to run whether or not cloud sync is configured. */
export function startMediaGcLoop(root) {
  const run = () => {
    sweepOrphanedMedia(root).catch((err) => {
      console.warn('AdKerala media GC: sweep failed —', err.message);
    });
  };
  const initialTimer = setTimeout(run, GC_INITIAL_DELAY_MS);
  const interval = setInterval(run, GC_INTERVAL_MS);
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

/** Remove ad/banner files no longer referenced in bus state. */
export async function deleteLocalMediaFiles(root, relativePaths = []) {
  if (!relativePaths?.length) return 0;

  const { mediaDir } = getDbPaths(root);
  let removed = 0;

  for (const relPath of relativePaths) {
    if (!relPath || relPath.includes('..')) continue;
    const category = relPath.split('/')[0];
    if (!MEDIA_CATEGORIES.has(category)) continue;

    const localFile = path.join(mediaDir, relPath);
    if (!existsSync(localFile)) continue;

    try {
      await fs.unlink(localFile);
      removed += 1;
      console.log('AdKerala media sync: removed', relPath);
    } catch (err) {
      console.warn('AdKerala media sync: delete failed', relPath, err.message);
    }
  }

  return removed;
}
