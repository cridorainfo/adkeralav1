/** Standard IAB / digital signage sizes used across the app. */
export const AD_SPECS = {
  fullscreen: {
    id: 'fullscreen',
    label: 'Fullscreen',
    width: 1920,
    height: 1080,
    aspectRatio: '16 / 9',
    maxImageBytes: 2.5 * 1024 * 1024,
    uploadHint: 'Standard: 1920×1080 (16:9) — JPG, PNG, MP4, WebM, or MOV (max 100 MB).',
    resolutionLabel: '1920×1080',
  },
  banner: {
    id: 'banner',
    label: 'Leaderboard banner',
    width: 728,
    height: 90,
    aspectRatio: '728 / 90',
    maxImageBytes: 512 * 1024,
    uploadHint: 'Full-width strip: 1920×120 — JPG, PNG, MP4, WebM, or MOV (max 100 MB).',
    resolutionLabel: '728×90',
  },
};

export function getAdSpec(format) {
  return AD_SPECS[format] ?? AD_SPECS.fullscreen;
}
