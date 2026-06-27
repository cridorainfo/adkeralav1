import { getAdSpec } from './adSpecs';

const MAX_VIDEO_BYTES = 3 * 1024 * 1024;
const IMAGE_JPEG_QUALITY = 0.85;

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image file'));
    };
    img.src = url;
  });
}

/** Scale and center-crop to exact standard ad dimensions. */
async function fitImageToAdSpec(file, format) {
  const spec = getAdSpec(format);
  const img = await loadImageFromFile(file);

  const canvas = document.createElement('canvas');
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext('2d');

  const scale = Math.max(spec.width / img.width, spec.height / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (spec.width - drawW) / 2;
  const y = (spec.height - drawH) / 2;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.drawImage(img, x, y, drawW, drawH);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error('Image processing failed'))),
      'image/jpeg',
      IMAGE_JPEG_QUALITY
    );
  });

  if (blob.size > spec.maxImageBytes) {
    throw new Error(
      `Image exceeds ${spec.resolutionLabel} size limit (${(blob.size / 1024 / 1024).toFixed(1)} MB). Use a simpler image.`
    );
  }

  return blobToDataUrl(blob);
}

function loadVideoMetadata(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({ width: video.videoWidth, height: video.videoHeight });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read video file'));
    };
    video.src = url;
  });
}

function warnIfVideoAspectMismatch(dimensions, spec) {
  if (!dimensions.width || !dimensions.height) return null;
  const ratio = dimensions.width / dimensions.height;
  const target = spec.width / spec.height;
  const tolerance = 0.08;
  if (Math.abs(ratio - target) / target > tolerance) {
    return `Video is ${dimensions.width}×${dimensions.height}. Recommended: ${spec.resolutionLabel} (${spec.label}).`;
  }
  return null;
}

/** Read and prepare ad media — normalizes images to standard IAB sizes. */
export async function readMediaForAd(file, format = 'fullscreen') {
  const spec = getAdSpec(format);

  if (file.type.startsWith('image/')) {
    return {
      type: 'image',
      mediaUrl: await fitImageToAdSpec(file, format),
      adFormat: spec.id,
      width: spec.width,
      height: spec.height,
    };
  }

  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error(
        `Video is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_VIDEO_BYTES / 1024 / 1024} MB.`
      );
    }

    let dimensions = { width: 0, height: 0 };
    let aspectWarning = null;
    try {
      dimensions = await loadVideoMetadata(file);
      aspectWarning = warnIfVideoAspectMismatch(dimensions, spec);
    } catch {
      /* still accept video if metadata read fails */
    }

    return {
      type: 'video',
      mediaUrl: await readFileAsDataUrl(file),
      adFormat: spec.id,
      width: dimensions.width || spec.width,
      height: dimensions.height || spec.height,
      aspectWarning,
    };
  }

  throw new Error('Unsupported file type. Use JPG, PNG, or MP4.');
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
