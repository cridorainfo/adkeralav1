import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getDbPaths } from './dbApi.js';

const MEDIA_CATEGORIES = new Set(['ads', 'banners', 'announcements', 'stops']);

const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';

function authHeaders(creds = {}) {
  return {
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(creds.deviceToken ? { 'X-Bus-Token': creds.deviceToken } : {}),
  };
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

    try {
      const res = await fetch(`${cloudUrl}/api/media/${relPath}`, {
        headers: authHeaders(creds),
      });
      if (!res.ok) {
        console.warn('AdKerala media sync: download failed', relPath, res.status);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await fs.writeFile(localFile, buffer);
      downloaded += 1;
      console.log('AdKerala media sync: saved', relPath);
    } catch (err) {
      console.warn('AdKerala media sync:', relPath, err.message);
    }
  }

  return downloaded;
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
