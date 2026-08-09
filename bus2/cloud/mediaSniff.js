/**
 * Server-side "is this actually the media type it claims to be" check for uploads — magic-byte
 * signature sniffing, not filename/extension or client-supplied Content-Type (both fully
 * attacker-controlled). Deliberately no new dependency: these are well-known, stable container
 * signatures and the list of formats this app actually needs to accept is short.
 *
 * Closes a stored-XSS path: without this, POST /api/media/upload accepted any bytes under any
 * extension with the client's own Content-Type header forwarded verbatim to storage — an
 * uploaded `ad.svg` containing a <script> would later be served same-origin as image/svg+xml and
 * execute in an admin's session when they review the campaign. See the security audit's finding
 * on this.
 */

function bytesMatch(buffer, offset, expected) {
  if (buffer.length < offset + expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (buffer[offset + i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

function hexMatch(buffer, offset, hexBytes) {
  if (buffer.length < offset + hexBytes.length) return false;
  for (let i = 0; i < hexBytes.length; i++) {
    if (buffer[offset + i] !== hexBytes[i]) return false;
  }
  return true;
}

const ISO_BMFF_BRANDS = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide']);

/** Returns { kind: 'image'|'video'|'audio', contentType } for a recognized signature, or null if
 * the bytes don't match any format this app accepts. Never trusts the filename/extension. */
export function sniffMediaType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // Images
  if (hexMatch(buffer, 0, [0xff, 0xd8, 0xff])) return { kind: 'image', contentType: 'image/jpeg' };
  if (hexMatch(buffer, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (bytesMatch(buffer, 0, 'GIF8')) return { kind: 'image', contentType: 'image/gif' };
  if (bytesMatch(buffer, 0, 'RIFF') && bytesMatch(buffer, 8, 'WEBP')) {
    return { kind: 'image', contentType: 'image/webp' };
  }

  // Video (ISO-BMFF family: mp4/m4v/mov) and audio (m4a uses the same container)
  if (bytesMatch(buffer, 4, 'ftyp')) {
    const brand = buffer.subarray(8, 12).toString('ascii').trim().toLowerCase();
    if (brand === 'm4a ' || brand === 'm4a') return { kind: 'audio', contentType: 'audio/mp4' };
    return { kind: 'video', contentType: 'video/mp4' };
  }
  // Legacy QuickTime .mov without a leading ftyp box.
  if (ISO_BMFF_BRANDS.has(buffer.subarray(4, 8).toString('ascii'))) {
    return { kind: 'video', contentType: 'video/quicktime' };
  }
  if (hexMatch(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', contentType: 'video/webm' };

  // Audio
  if (bytesMatch(buffer, 0, 'ID3')) return { kind: 'audio', contentType: 'audio/mpeg' };
  if (hexMatch(buffer, 0, [0xff, 0xfb]) || hexMatch(buffer, 0, [0xff, 0xf3]) || hexMatch(buffer, 0, [0xff, 0xf2])) {
    return { kind: 'audio', contentType: 'audio/mpeg' };
  }
  if (bytesMatch(buffer, 0, 'RIFF') && bytesMatch(buffer, 8, 'WAVE')) {
    return { kind: 'audio', contentType: 'audio/wav' };
  }
  if (bytesMatch(buffer, 0, 'OggS')) return { kind: 'audio', contentType: 'audio/ogg' };

  return null;
}

/** Which media kind(s) a given upload category legitimately holds — ads/banners/schedule are
 * fullscreen/banner/playlist visuals (image or video); announcements/stops are spoken-audio
 * clips (audio only). */
const CATEGORY_ALLOWED_KINDS = {
  ads: ['image', 'video'],
  banners: ['image', 'video'],
  schedule: ['image', 'video'],
  announcements: ['audio'],
  stops: ['audio'],
};

/** Validates a decoded upload buffer against its category, returning the sniffed
 * {kind, contentType} on success or null if the bytes don't match any signature this category
 * accepts (whether that's an unrecognized format entirely, or a real file of the wrong kind —
 * e.g. an image uploaded to an audio-only category). */
export function validateMediaForCategory(buffer, category) {
  const sniffed = sniffMediaType(buffer);
  if (!sniffed) return null;
  const allowedKinds = CATEGORY_ALLOWED_KINDS[category] ?? [];
  return allowedKinds.includes(sniffed.kind) ? sniffed : null;
}
