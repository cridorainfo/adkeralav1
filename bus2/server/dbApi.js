import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { reconcileStopAudioFromDisk } from './stopAudioReconcile.js';
import { reconcilePhraseAudioFromDisk } from './phraseAudioReconcile.js';
import { requireDriverAuthUnlessLocal } from './driverAuth.js';
import { notifyStateChanged, subscribeStateChanged } from './stateEvents.js';
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
async function loadInfoRaw(root) {
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
      if (fast) {
        await writeInfoFileFast(root, data);
      } else {
        await writeInfoFile(root, data);
      }
      notifyStateChanged(root, {
        savedAt: data?.savedAt ?? 0,
        lastCloudPushAt: data?.lastCloudPushAt ?? 0,
        driveRevision: data?.driveRevision ?? 0,
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
      const data = await readInfoFile(root);
      res.json({ ok: true, data: data ?? {} });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** Live push to display/control when db/info.txt changes — no app restart needed. */
  app.get('/api/state/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const writeEvent = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      res.flush?.();
    };

    writeEvent({ type: 'connected', at: Date.now() });

    const unsub = subscribeStateChanged(root, (detail) => {
      writeEvent({ type: 'state-changed', ...detail });
    });

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });

  app.post('/api/state', requireDriverAuthUnlessLocal, async (req, res) => {
    try {
      await ensureDbLayout(root);
      const current = (await readInfoFile(root)) ?? {};
      const { mergeIncomingState } = await import('./stateMerge.js');
      const merged = mergeIncomingState(current, req.body ?? {});
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

  app.post('/api/media/:category', requireDriverAuthUnlessLocal, expressRawUpload, async (req, res) => {
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

  app.delete('/api/media/file', requireDriverAuthUnlessLocal, async (req, res) => {
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
