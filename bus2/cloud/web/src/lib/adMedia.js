/** Admin ad upload limits — JSON base64 upload must stay under server body limit. */
export const AD_MEDIA_ACCEPT = 'image/*,video/*,.mp4,.webm,.mov,.m4v';

export const MAX_AD_VIDEO_BYTES = 20 * 1024 * 1024;

export const AD_UPLOAD_HINTS = {
  fullscreen:
    '1920×1080 (16:9) recommended — JPG, PNG, MP4, WebM, or MOV. Video max 20 MB.',
  banner:
    '1920×120 full-width strip recommended — JPG, PNG, MP4, WebM, or MOV. Video max 20 MB.',
};

export function isVideoMediaFile(file) {
  if (!file) return false;
  if (file.type?.startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name ?? '');
}

export function adMediaTypeFromFile(file) {
  return isVideoMediaFile(file) ? 'video' : 'image';
}

export function validateAdMediaFile(file) {
  if (!file) return 'No file selected';
  const isVideo = isVideoMediaFile(file);
  const isImage = file.type?.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(file.name ?? '');
  if (!isVideo && !isImage) {
    return 'Use JPG, PNG, MP4, WebM, or MOV.';
  }
  if (isVideo && file.size > MAX_AD_VIDEO_BYTES) {
    return `Video is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_AD_VIDEO_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}
