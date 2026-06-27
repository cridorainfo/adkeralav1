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
  if (!cloudUrl || !relativePaths?.length) return;

  const { mediaDir } = getDbPaths(root);

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
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      await fs.mkdir(path.dirname(localFile), { recursive: true });
      await fs.writeFile(localFile, buffer);
    } catch (err) {
      console.warn('AdKerala media sync:', relPath, err.message);
    }
  }
}
