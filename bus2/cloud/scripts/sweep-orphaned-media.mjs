#!/usr/bin/env node
/**
 * One-time cleanup: find (and optionally delete) media files on disk that nothing in the
 * system references anymore — campaigns, house ads, every bus's ad catalog, stop voice-ads,
 * stop announcement audio, and global phrase audio. These accumulate because campaign delete,
 * house-ad replacement, and stop ad-voice replacement never used to purge their old files (see
 * collectAllReferencedMediaPaths in ../store.js for the fix going forward — this script is only
 * for the backlog that built up before that fix existed).
 *
 * Dry run by default — lists what it would remove without touching anything. Pass --delete to
 * actually remove the orphaned files.
 *
 * Usage (run wherever DATA_DIR points at the real media volume, e.g. via `railway run`):
 *   node cloud/scripts/sweep-orphaned-media.mjs
 *   node cloud/scripts/sweep-orphaned-media.mjs --delete
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { collectAllReferencedMediaPaths } from '../store.js';
import { deleteMediaFile } from '../mediaStorage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CATEGORIES = ['ads', 'banners', 'stops', 'announcements'];

async function listFilesUnder(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function main() {
  const shouldDelete = process.argv.includes('--delete');
  console.log(`Media dir: ${MEDIA_DIR}`);
  console.log(shouldDelete ? 'Mode: DELETE' : 'Mode: dry run (pass --delete to actually remove)');
  console.log('');

  const inUse = await collectAllReferencedMediaPaths();

  let totalOrphans = 0;
  let totalBytes = 0;

  for (const category of CATEGORIES) {
    const dir = path.join(MEDIA_DIR, category);
    const files = await listFilesUnder(dir);
    for (const filename of files) {
      const relPath = `${category}/${filename}`;
      if (inUse.has(relPath)) continue;

      const fullPath = path.join(dir, filename);
      const stat = await fs.stat(fullPath).catch(() => null);
      const size = stat?.size ?? 0;
      totalOrphans += 1;
      totalBytes += size;

      if (shouldDelete) {
        const result = await deleteMediaFile(relPath, MEDIA_DIR);
        console.log(`${result.ok ? 'Deleted' : 'FAILED'}  ${relPath}  (${(size / 1024).toFixed(1)} KB)`);
      } else {
        console.log(`Orphaned  ${relPath}  (${(size / 1024).toFixed(1)} KB)`);
      }
    }
  }

  console.log('');
  console.log(`${totalOrphans} orphaned file(s), ${(totalBytes / 1024 / 1024).toFixed(2)} MB total.`);
  if (!shouldDelete && totalOrphans > 0) {
    console.log('Dry run only — nothing was deleted. Re-run with --delete to actually remove them.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
