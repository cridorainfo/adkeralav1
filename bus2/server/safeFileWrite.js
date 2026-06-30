import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export function backupPathFor(filePath) {
  return `${filePath}.bak`;
}

export function tmpPathFor(filePath) {
  return `${filePath}.tmp`;
}

async function replaceFile(tmp, filePath) {
  try {
    await fs.rename(tmp, filePath);
  } catch {
    await fs.copyFile(tmp, filePath);
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
