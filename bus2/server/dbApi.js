import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { reconcileStopAudioFromDisk } from './stopAudioReconcile.js';
import { reconcilePhraseAudioFromDisk } from './phraseAudioReconcile.js';
import { requireHubAuthUnlessLocal } from './hubSessions.js';
import { notifyStateChanged, subscribeStateChanged } from './stateEvents.js';
import { applyBusCorsToResponse } from './cors.js';
import {
  atomicWriteTextFile,
  backupPathFor,
  durableWriteTextFile,
  readBestRecoverableFile,
  snapshotBackup,
} from './safeFileWrite.js';
import {
  archiveInfoContent,
  archiveRelativeLabel,
  readBestInfoArchive,
} from './stateArchive.js';
import { ensureActiveRouteId } from '../src/store/busStore.js';

const MEDIA_CATEGORIES = new Set(['ads', 'banners', 'announcements', 'stops']);

export function getDbPaths(root) {
  const dbDir = path.join(root, 'db');
  const infoFile = path.join(dbDir, 'info.txt');
  return {
    dbDir,
    infoFile,
    infoBackup: backupPathFor(infoFile),
    mediaDir: path.join(dbDir, 'media'),
  };
}

function infoSavedAt(raw) {
  try {
    return parseInfoText(raw)?.savedAt ?? 0;
  } catch {
    return 0;
  }
}

function isValidInfoRaw(raw) {
  try {
    parseInfoText(raw);
    return true;
  } catch {
    return false;
  }
}

/** Load info.txt from db/, siblings, or .adkerala-state-archive/ — restores main when needed. */
const loadInfoRawInflight = new Map();

async function loadInfoRawOnce(root) {
  const { infoFile } = getDbPaths(root);
  const localBest = await readBestRecoverableFile(infoFile, {
    validate: isValidInfoRaw,
    score: infoSavedAt,
  });
  const archiveBest = await readBestInfoArchive(root, {
    validate: isValidInfoRaw,
    score: infoSavedAt,
  });

  let best = localBest;
  if (archiveBest && (!best || archiveBest.score >= best.score)) {
    best = archiveBest;
  }
  if (!best) return null;

  if (best.sourcePath !== infoFile) {
    console.warn(
      `AdKerala: recovered db/info.txt from ${archiveRelativeLabel(best.sourcePath, root)} after unexpected shutdown`
    );
    await durableWriteTextFile(infoFile, best.raw);
    await atomicWriteTextFile(backupPathFor(infoFile), best.raw).catch(() => {});
    await archiveInfoContent(root, best.raw, { savedAt: infoSavedAt(best.raw) }).catch(() => {});
  }

  return best.raw;
}

async function loadInfoRaw(root) {
  const key = path.resolve(root);
  if (loadInfoRawInflight.has(key)) {
    return loadInfoRawInflight.get(key);
  }
  const task = loadInfoRawOnce(root);
  loadInfoRawInflight.set(key, task);
  try {
    return await task;
  } finally {
    loadInfoRawInflight.delete(key);
  }
}

function buildInfoContent(data) {
  const header = `# AdKerala — routes, stops, settings (JSON below)
# Edit this file in Notepad. Put media files in db/media/ subfolders.
# Use "mediaFile" and "audioFile" for paths like "ads/promo.mp4" (relative to db/media/).
`;
  return header + JSON.stringify(data, null, 2) + '\n';
}

export async function ensureDbLayout(root) {
  const { dbDir, infoFile, mediaDir } = getDbPaths(root);
  await fs.mkdir(path.join(mediaDir, 'ads'), { recursive: true });
  await fs.mkdir(path.join(mediaDir, 'banners'), { recursive: true });
  await fs.mkdir(path.join(mediaDir, 'announcements'), { recursive: true });
  await fs.mkdir(path.join(mediaDir, 'stops'), { recursive: true });

  if (!existsSync(infoFile)) {
    const template = path.join(dbDir, 'info.template.txt');
    if (existsSync(template)) {
      await fs.copyFile(template, infoFile);
    }
  }
}

/** Strip # comment lines and parse the first complete JSON object from info.txt */
export function parseInfoText(raw) {
  const jsonText = raw
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();

  try {
    return JSON.parse(jsonText);
  } catch {
    const start = jsonText.indexOf('{');
    if (start < 0) {
      throw new SyntaxError('No JSON object found in db/info.txt');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < jsonText.length; i++) {
      const ch = jsonText[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return JSON.parse(jsonText.slice(start, i + 1));
        }
      }
    }

    throw new SyntaxError('Unclosed JSON object in db/info.txt');
  }
}

export async function readInfoFile(root) {
  try {
    const raw = await loadInfoRaw(root);
    if (raw == null) return null;

    const stripped = raw
      .split(/\r?\n/)
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
      .trim();

    let needsRepair = false;
    try {
      JSON.parse(stripped);
    } catch {
      needsRepair = true;
    }

    const data = parseInfoText(raw);
    if (needsRepair) {
      void writeInfoFileSerialized(root, data);
      console.warn('AdKerala: repaired corrupt db/info.txt (removed invalid trailing content)');
    }
    const { state: reconciled, changed } = await reconcileStopAudioFromDisk(root, data);
    const { state: withPhrases, changed: phrasesChanged } = await reconcilePhraseAudioFromDisk(
      root,
      reconciled
    );
    if (changed || phrasesChanged) {
      void writeInfoFileSerialized(root, withPhrases);
      if (changed) {
        console.log('AdKerala: linked stop audio files from db/media/stops/ into stopAudio');
      }
      if (phrasesChanged) {
        console.log(
          'AdKerala: linked shared phrase audio from db/media/announcements/ into audioFragments'
        );
      }
    }
    return withPhrases;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeInfoFile(root, data) {
  const { infoFile } = getDbPaths(root);
  const content = buildInfoContent(data);
  const savedAt = data?.savedAt ?? Date.now();

  await archiveInfoContent(root, content, { savedAt });
  await snapshotBackup(infoFile, isValidInfoRaw);
  await durableWriteTextFile(infoFile, content);
  await atomicWriteTextFile(backupPathFor(infoFile), content).catch(() => {});
}

/** Hot path for driver Forward / route — skip archive snapshot to keep display in sync. */
export async function writeInfoFileFast(root, data) {
  const { infoFile } = getDbPaths(root);
  const content = buildInfoContent(data);
  await durableWriteTextFile(infoFile, content);
  await atomicWriteTextFile(backupPathFor(infoFile), content).catch(() => {});
}

let writeInfoQueue = Promise.resolve();

/** Serialize writes to db/info.txt so cloud sync and API saves cannot interleave. */
export function writeInfoFileSerialized(root, data, meta = {}) {
  const fast = meta.source === 'drive-api';
  writeInfoQueue = writeInfoQueue
    .then(async () => {
      let payload = data;
      try {
        const current = (await readInfoFile(root)) ?? {};
        if (!(payload.routes?.length) && (current.routes?.length)) {
          payload = {
            ...payload,
            routes: current.routes,
            activeRouteId: payload.activeRouteId ?? current.activeRouteId ?? null,
          };
        }
        const tripLive = Boolean(current.tripStarted) && !Boolean(current.tripEnded);
        if (
          tripLive &&
          !Boolean(payload.tripStarted) &&
          (payload.driveRevision ?? 0) <= (current.driveRevision ?? 0) &&
          meta.source !== 'drive-api'
        ) {
          payload = {
            ...payload,
            tripStarted: current.tripStarted,
            tripEnded: current.tripEnded,
            tripDeparted: current.tripDeparted,
            currentStopIndex: current.currentStopIndex,
            routeDirection: current.routeDirection,
            driveRevision: current.driveRevision,
            activeRouteId: payload.activeRouteId ?? current.activeRouteId,
          };
        }
      } catch {
        /* use payload as-is */
      }
      payload = ensureActiveRouteId(payload);
      if (fast) {
        await writeInfoFileFast(root, payload);
      } else {
        await writeInfoFile(root, payload);
      }
      notifyStateChanged(root, {
        savedAt: payload?.savedAt ?? 0,
        lastCloudPushAt: payload?.lastCloudPushAt ?? 0,
        driveRevision: payload?.driveRevision ?? 0,
        source: meta.source ?? 'write',
      });
    })
    .catch((err) => {
      console.warn('AdKerala: db/info.txt write failed:', err.message);
    });
  return writeInfoQueue;
}

function safeFilename(name) {
  return String(name)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'file';
}

export async function saveMediaFile(root, category, buffer, originalName) {
  if (!MEDIA_CATEGORIES.has(category)) {
    throw new Error(`Invalid media category: ${category}`);
  }
  const { mediaDir } = getDbPaths(root);
  const dir = path.join(mediaDir, category);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(originalName || '') || '';
  const base = safeFilename(path.basename(originalName || 'upload', ext));
  const filename = `${Date.now()}-${base}${ext}`;
  const relPath = `${category}/${filename}`;
  await fs.writeFile(path.join(mediaDir, relPath), buffer);
  return relPath;
}

export async function deleteMediaFile(root, relPath) {
  if (!relPath || relPath.includes('..')) return;
  const { mediaDir } = getDbPaths(root);
  const full = path.join(mediaDir, relPath);
  if (!full.startsWith(mediaDir)) return;
  try {
    await fs.unlink(full);
  } catch {
    /* ignore missing */
  }
}

export function setupDbApi(app, root) {
  const { mediaDir } = getDbPaths(root);

  app.use('/db/media', (req, res, next) => {
    const filePath = path.join(mediaDir, req.path.replace(/^\/+/, ''));
    if (!filePath.startsWith(mediaDir)) {
      res.status(403).end();
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).end();
      return;
    }
    res.sendFile(filePath);
  });

  app.get('/api/state', async (_req, res) => {
    try {
      await ensureDbLayout(root);
      const { normalizeClientState } = await import('./hubSessions.js');
      const raw = (await readInfoFile(root)) ?? {};
      const data = normalizeClientState(raw);
      if (data.activeRouteId && data.activeRouteId !== raw.activeRouteId) {
        void writeInfoFileSerialized(
          root,
          { ...raw, activeRouteId: data.activeRouteId },
          { source: 'normalize-active-route' }
        ).catch(() => {});
      }
      res.json({ ok: true, data });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** Live push to display/control when db/info.txt changes — no app restart needed. */
  app.get('/api/state/events', (req, res) => {
    applyBusCorsToResponse(req, res);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    let backpressuredSince = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(maxLifetime);
      unsub();
      res.end();
    };

    // stateEvents.js sizes its emitter for many concurrent phones (setMaxListeners(200)) — a
    // mobile client that goes silent without a clean TCP close (Wi‑Fi → cellular handoff, etc.)
    // would otherwise leave res.write() buffering forever and this subscription never
    // unsubscribed. Track backpressure via write()'s boolean return and force-close (the
    // client's own EventSource auto-reconnects) if it doesn't clear within a grace window.
    const writeRaw = (chunk) => {
      if (closed) return;
      const flushedImmediately = res.write(chunk);
      res.flush?.();
      if (!flushedImmediately) {
        if (backpressuredSince === null) backpressuredSince = Date.now();
      } else {
        backpressuredSince = null;
      }
    };

    const writeEvent = (payload) => writeRaw(`data: ${JSON.stringify(payload)}\n\n`);

    writeEvent({ type: 'connected', at: Date.now() });

    const unsub = subscribeStateChanged(root, (detail) => {
      writeEvent({ type: 'state-changed', ...detail });
    });

    const BACKPRESSURE_GRACE_MS = 30000;
    const heartbeat = setInterval(() => {
      if (backpressuredSince !== null && Date.now() - backpressuredSince > BACKPRESSURE_GRACE_MS) {
        cleanup();
        return;
      }
      writeRaw(': heartbeat\n\n');
    }, 25000);
    heartbeat.unref?.();

    // Bound worst-case zombie lifetime even if req.on('close') never fires at all. unref()'d
    // so a lingering connection can never be the sole reason the process/a test stays alive.
    const maxLifetime = setTimeout(cleanup, 10 * 60 * 1000);
    maxLifetime.unref?.();

    req.on('close', cleanup);
  });

  app.post('/api/state', requireHubAuthUnlessLocal, async (req, res) => {
    try {
      await ensureDbLayout(root);
      const current = (await readInfoFile(root)) ?? {};
      const { mergeIncomingState } = await import('./stateMerge.js');
      const { getConnectedDeviceCount, normalizeClientState } = await import('./hubSessions.js');
      const merged = mergeIncomingState(current, req.body ?? {});
      merged.connectedDeviceCount = getConnectedDeviceCount();
      const tripUnchanged =
        (merged.driveRevision ?? 0) === (current.driveRevision ?? 0) &&
        (merged.currentStopIndex ?? 0) === (current.currentStopIndex ?? 0) &&
        Boolean(merged.tripStarted) === Boolean(current.tripStarted) &&
        Boolean(merged.tripEnded) === Boolean(current.tripEnded) &&
        (merged.driverLink?.driverId ?? null) === (current.driverLink?.driverId ?? null) &&
        JSON.stringify(merged.busProfile ?? {}) === JSON.stringify(current.busProfile ?? {}) &&
        (merged.savedAt ?? 0) <= (current.savedAt ?? 0);
      if (tripUnchanged) {
        res.json({ ok: true, unchanged: true });
        return;
      }
      await writeInfoFileSerialized(root, merged);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/media/:category', requireHubAuthUnlessLocal, expressRawUpload, async (req, res) => {
    try {
      const category = req.params.category;
      if (!MEDIA_CATEGORIES.has(category)) {
        res.status(400).json({ ok: false, error: 'Invalid category' });
        return;
      }
      const file = req.uploadedFile;
      if (!file) {
        res.status(400).json({ ok: false, error: 'No file uploaded' });
        return;
      }
      const relPath = await saveMediaFile(root, category, file.buffer, file.filename);
      res.json({ ok: true, path: relPath, url: `/db/media/${relPath}` });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/media/file', requireHubAuthUnlessLocal, async (req, res) => {
    try {
      const relPath = String(req.query.path ?? '').trim();
      if (!relPath) {
        res.status(400).json({ ok: false, error: 'Missing path' });
        return;
      }
      const category = relPath.split('/')[0];
      if (!MEDIA_CATEGORIES.has(category)) {
        res.status(400).json({ ok: false, error: 'Invalid media path' });
        return;
      }
      await deleteMediaFile(root, relPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}

/** Minimal multipart parser middleware (single file field "file") */
function expressRawUpload(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    next();
    return;
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) {
    next();
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const body = Buffer.concat(chunks);
      const parts = parseMultipart(body, boundary);
      const filePart = parts.find((p) => p.name === 'file');
      req.uploadedFile = filePart
        ? { buffer: filePart.data, filename: filePart.filename || 'upload.bin' }
        : null;
      next();
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = body.indexOf(delimiter) + delimiter.length;

  while (start < body.length) {
    if (body[start] === 45 && body[start + 1] === 45) break;
    if (body[start] === 13 && body[start + 1] === 10) start += 2;

    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = body.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    const nextBoundary = body.indexOf(delimiter, dataStart);
    const dataEnd = nextBoundary === -1 ? body.length : nextBoundary - 2;
    const data = body.slice(dataStart, dataEnd);

    const nameMatch = headerText.match(/name="([^"]+)"/);
    const fileMatch = headerText.match(/filename="([^"]+)"/);
    parts.push({
      name: nameMatch?.[1],
      filename: fileMatch?.[1],
      data,
    });
    start = nextBoundary + delimiter.length;
  }
  return parts;
}
