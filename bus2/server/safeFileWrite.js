import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export function backupPathFor(filePath) {
  return `${filePath}.bak`;
}

export function tmpPathFor(filePath) {
  return `${filePath}.tmp`;
}

// On Windows, antivirus/OneDrive/a second app instance can briefly hold an exclusive
// handle on the destination file — rename() or copyFile() then fails with EPERM/EBUSY
// even though nothing is actually wrong. These locks are almost always released within
// milliseconds, so retry a few times with backoff before treating it as a real failure.
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [50, 100, 250, 500, 1000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!RETRYABLE_CODES.has(err?.code) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function replaceFile(tmp, filePath) {
  try {
    await withRetry(() => fs.rename(tmp, filePath));
  } catch {
    // rename() also fails (not just "not atomic on this volume") when the destination
    // is a different drive — copyFile is the correct fallback for that case, and still
    // benefits from the same retry treatment if the file is transiently locked.
    await withRetry(() => fs.copyFile(tmp, filePath));
    await fs.unlink(tmp).catch(() => {});
  }
}

/** Write via temp file + replace — avoids truncating the live file on power loss mid-write. */
export async function atomicWriteTextFile(filePath, content) {
  const tmp = tmpPathFor(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, content, 'utf8');
  await replaceFile(tmp, filePath);
}

/** Flush to disk before rename — use for critical state files. */
export async function durableWriteTextFile(filePath, content) {
  const tmp = tmpPathFor(filePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await replaceFile(tmp, filePath);
}

/**
 * Try reading path and every .tmp / .bak sibling; return the best match by scoreFn.
 * @returns {{ raw: string, sourcePath: string, score: number } | null}
 */
export async function readBestRecoverableFile(filePath, { validate, score = () => 0 }) {
  const candidates = [filePath, tmpPathFor(filePath), backupPathFor(filePath)];
  let best = null;

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (!validate(raw)) continue;
      const candidateScore = score(raw);
      if (!best || candidateScore >= best.score) {
        best = { raw, sourcePath: candidate, score: candidateScore };
      }
    } catch {
      /* unreadable candidate */
    }
  }

  return best;
}

/** Copy current file to .bak when it passes validate — keeps last known-good snapshot. */
export async function snapshotBackup(filePath, validate) {
  if (!existsSync(filePath)) return false;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!validate(raw)) return false;
    await atomicWriteTextFile(backupPathFor(filePath), raw);
    return true;
  } catch {
    return false;
  }
}
