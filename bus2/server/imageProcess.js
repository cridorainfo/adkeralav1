import sharp from 'sharp';
import path from 'path';

/** Bus display never shows an ad/banner larger than this — no point storing or
 * transferring pixels beyond it. */
const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * Shrinks oversized ad/banner images (e.g. full-resolution phone photos) and
 * re-compresses them so the bus display isn't downloading and decoding a
 * multi-megabyte original just to show it at a few hundred pixels wide — that's
 * what made images visibly paint top-to-bottom in bands. Video and non-image
 * files pass through untouched. Never throws: falls back to the original
 * buffer if processing fails or doesn't actually shrink the file.
 */
export async function optimizeImageBuffer(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return buffer;

  try {
    let pipeline = sharp(buffer, { failOn: 'none' }).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

    pipeline =
      ext === '.png'
        ? pipeline.png({ compressionLevel: 9 })
        : ext === '.webp'
          ? pipeline.webp({ quality: WEBP_QUALITY })
          : pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

    const optimized = await pipeline.toBuffer();
    return optimized.length < buffer.length ? optimized : buffer;
  } catch {
    return buffer;
  }
}
