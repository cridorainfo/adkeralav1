/** Admin ad upload limits — JSON base64 upload must stay under server body limit. */
export const AD_MEDIA_ACCEPT = 'image/*,video/*,.mp4,.webm,.mov,.m4v';

export const MAX_AD_VIDEO_BYTES = 100 * 1024 * 1024;

export const AD_UPLOAD_HINTS = {
  fullscreen:
    '1920×1080 (16:9) recommended — JPG, PNG, MP4, WebM, or MOV. Max 100 MB.',
  banner:
    '1920×120 full-width strip recommended — JPG, PNG, MP4, WebM, or MOV. Max 100 MB.',
};

export function isVideoMediaFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name ?? '');
}

export function adMediaTypeFromFile(file) {
  return isVideoMediaFile(file) ? 'video' : 'image';
}

/** Authenticated dashboard URL for a stored ad/banner file (e.g. ads/1234-promo.mp4). */
export function adMediaPreviewUrl(mediaFile) {
  if (!mediaFile || typeof mediaFile !== 'string') return null;
  const normalized = mediaFile.replace(/^\/+/, '');
  const slash = normalized.indexOf('/');
  if (slash <= 0) return null;
  const category = normalized.slice(0, slash);
  const filename = normalized.slice(slash + 1);
  if (!['ads', 'banners'].includes(category) || !filename) return null;
  return `/api/media/preview/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`;
}

export function validateAdMediaFile(file) {
  if (!file) return 'No file selected';
  const isVideo = isVideoMediaFile(file);
  const isImage = file.type?.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(file.name ?? '');
  if (!isVideo && !isImage) {
    return 'Use JPG, PNG, MP4, WebM, or MOV.';
  }
  if (file.size > MAX_AD_VIDEO_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_AD_VIDEO_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
