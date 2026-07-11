import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { atomicWriteTextFile, durableWriteTextFile } from './safeFileWrite.js';

/** Separate from db/ — survives corruption/empty wipes in db/info.txt and siblings. */
export const STATE_ARCHIVE_DIR = '.adkerala-state-archive';
export const MAX_INFO_SNAPSHOTS = 12;

export function getStateArchiveRoot(dataRoot) {
  return path.join(dataRoot, STATE_ARCHIVE_DIR);
}

export function getInfoArchiveDir(dataRoot) {
  return path.join(getStateArchiveRoot(dataRoot), 'info');
}

function infoLatestArchivePath(dataRoot) {
  return path.join(getInfoArchiveDir(dataRoot), 'latest.txt');
}

function infoSnapshotsDir(dataRoot) {
  return path.join(getInfoArchiveDir(dataRoot), 'snapshots');
}

function snapshotName(savedAt) {
  const stamp = Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now();
  return `info-${stamp}.txt`;
}

async function pruneInfoSnapshots(dataRoot, keep = MAX_INFO_SNAPSHOTS) {
  const dir = infoSnapshotsDir(dataRoot);
  if (!existsSync(dir)) return;
  let files = [];
  try {
    files = (await fs.readdir(dir)).filter((name) => name.startsWith('info-') && name.endsWith('.txt'));
  } catch {
    return;
  }
  files.sort((a, b) => {
    const ta = Number(a.slice(5, -4)) || 0;
    const tb = Number(b.slice(5, -4)) || 0;
    return tb - ta;
  });
  for (const name of files.slice(keep)) {
    await fs.unlink(path.join(dir, name)).catch(() => {});
  }
}

/**
 * Persist a known-good info.txt copy outside db/ BEFORE updating the live file.
 * Order matters for power-loss safety: archive first, then db/info.txt.
 */
export async function archiveInfoContent(dataRoot, content, { savedAt = 0 } = {}) {
  if (!content || !String(content).trim()) return;
  const latest = infoLatestArchivePath(dataRoot);
  const snapshots = infoSnapshotsDir(dataRoot);
  await fs.mkdir(snapshots, { recursive: true });

  await durableWriteTextFile(latest, content);

  const snapPath = path.join(snapshots, snapshotName(savedAt));
  if (!existsSync(snapPath)) {
    await durableWriteTextFile(snapPath, content);
  } else {
    await atomicWriteTextFile(snapPath, content);
  }

  await pruneInfoSnapshots(dataRoot);
}

/** Collect every archived info.txt candidate (latest + rotating snapshots). */
export async function listInfoArchivePaths(dataRoot) {
  const paths = [];
  const latest = infoLatestArchivePath(dataRoot);
  if (existsSync(latest)) paths.push(latest);

  const dir = infoSnapshotsDir(dataRoot);
  if (!existsSync(dir)) return paths;

  let names = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return paths;
  }

  for (const name of names) {
    if (!name.startsWith('info-') || !name.endsWith('.txt')) continue;
    const full = path.join(dir, name);
    if (!paths.includes(full)) paths.push(full);
  }
  return paths;
}

/**
 * @returns {{ raw: string, sourcePath: string, score: number } | null}
 */
export async function readBestInfoArchive(dataRoot, { validate, score = () => 0 }) {
  const paths = await listInfoArchivePaths(dataRoot);
  let best = null;

  for (const candidate of paths) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (!validate(raw)) continue;
      const candidateScore = score(raw);
      // Strictly-greater tie-break — see safeFileWrite.js's readBestRecoverableFile for why
      // >= here would let a rotating snapshot arbitrarily out-rank latest.txt on a tie.
      if (!best || candidateScore > best.score) {
        best = { raw, sourcePath: candidate, score: candidateScore };
      }
    } catch {
      /* unreadable */
    }
  }

  return best;
}

export function archiveRelativeLabel(sourcePath, dataRoot) {
  const rel = path.relative(dataRoot, sourcePath);
  return rel || path.basename(sourcePath);
}

function jsonArchiveDir(dataRoot, name) {
  return path.join(getStateArchiveRoot(dataRoot), name);
}

function jsonLatestPath(dataRoot, name) {
  return path.join(jsonArchiveDir(dataRoot, name), 'latest.json');
}

export async function archiveJsonContent(dataRoot, name, content) {
  if (!content) return;
  const latest = jsonLatestPath(dataRoot, name);
  await fs.mkdir(path.dirname(latest), { recursive: true });
  await durableWriteTextFile(latest, content);
}

export async function readArchivedJson(dataRoot, name, { validate = () => true } = {}) {
  const latest = jsonLatestPath(dataRoot, name);
  if (!existsSync(latest)) return null;
  try {
    const raw = await fs.readFile(latest, 'utf8');
    if (!validate(raw)) return null;
    return { raw, sourcePath: latest };
  } catch {
    return null;
  }
}
