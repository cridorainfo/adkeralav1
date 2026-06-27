import { getAllStops, normalizeStop } from '../store/busStore';
import { stopAudioKey } from './audioFragments';

/** Scan routes for missing Malayalam labels or announcement audio. */
export function scanContentGaps(state) {
  const gaps = [];
  const seen = new Set();

  for (const route of state.routes ?? []) {
    for (const stop of getAllStops(route)) {
      const normalized = normalizeStop(stop);
      const key = stopAudioKey(normalized);
      if (!key || seen.has(`${route.id}:${key}`)) continue;
      seen.add(`${route.id}:${key}`);

      const missing = [];
      if (!normalized.ml) missing.push('malayalam_text');
      if (!state.stopAudio?.[key]?.ml?.audioUrl && !state.stopAudio?.[key]?.ml?.audioFile) {
        missing.push('malayalam_audio');
      }
      if (!state.stopAudio?.[key]?.en?.audioUrl && !state.stopAudio?.[key]?.en?.audioFile) {
        missing.push('english_audio');
      }

      if (missing.length) {
        gaps.push({
          routeId: route.id,
          routeName: route.name,
          stopKey: key,
          en: normalized.en,
          ml: normalized.ml || null,
          lat: normalized.lat ?? null,
          lng: normalized.lng ?? null,
          missing,
        });
      }
    }
  }

  return gaps;
}
