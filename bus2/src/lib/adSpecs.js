/** Standard IAB / digital signage sizes used across the app. */
export const AD_SPECS = {
  fullscreen: {
    id: 'fullscreen',
    label: 'Fullscreen',
    width: 1920,
    height: 1080,
    aspectRatio: '16 / 9',
    maxImageBytes: 2.5 * 1024 * 1024,
    uploadHint: 'Standard: 1920×1080 (16:9) — JPG, PNG, or MP4. Google Ads & signage compatible.',
    resolutionLabel: '1920×1080',
  },
  banner: {
    id: 'banner',
    label: 'Leaderboard banner',
    width: 728,
    height: 90,
    aspectRatio: '728 / 90',
    maxImageBytes: 512 * 1024,
    uploadHint: 'Standard: 728×90 (IAB Leaderboard) — JPG, PNG, or MP4. Google Display compatible.',
    resolutionLabel: '728×90',
  },
};

export function getAdSpec(format) {
  return AD_SPECS[format] ?? AD_SPECS.fullscreen;
}
