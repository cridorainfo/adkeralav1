import { randomUUID } from 'crypto';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? '';
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY ?? '';
const R2_SECRET_KEY = process.env.R2_SECRET_KEY ?? '';
const R2_BUCKET = process.env.R2_BUCKET ?? '';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? '').replace(/\/+$/, '');

export function isR2Enabled() {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY && R2_SECRET_KEY && R2_BUCKET);
}

export function getPublicMediaUrl(relativePath) {
  if (!relativePath) return null;
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${relativePath}`;
  return null;
}

export async function uploadMediaBuffer(relativePath, buffer, contentType = 'application/octet-stream') {
  if (!isR2Enabled()) return { ok: false, local: true };

  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${relativePath}`;
  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      Authorization: `Bearer ${R2_ACCESS_KEY}:${R2_SECRET_KEY}`,
    },
    body: buffer,
  });

  if (!res.ok) {
    return { ok: false, error: `R2 upload failed: ${res.status}` };
  }

  return {
    ok: true,
    url: getPublicMediaUrl(relativePath),
    path: relativePath,
  };
}

export function buildMediaPath(category, filename) {
  const safeName = String(filename ?? randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${category}/${safeName}`;
}

export async function getUploadTarget(category, filename) {
  const relPath = buildMediaPath(category, filename);
  if (isR2Enabled()) {
    return { ok: true, mode: 'r2', path: relPath, publicUrl: getPublicMediaUrl(relPath) };
  }
  return { ok: true, mode: 'local', path: relPath };
}

export function verifyR2Config() {
  return { enabled: isR2Enabled(), bucket: R2_BUCKET || null, publicUrl: R2_PUBLIC_URL || null };
}
