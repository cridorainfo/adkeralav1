import { normalizeStop, getAllStops } from '../store/busStore.js';
import { mediaPathToUrl } from './fileStorage.js';

/** Resolve a stored clip entry to a playable URL (audioUrl or audioFile). */
export function resolveClipUrl(entry) {
  if (!entry) return null;
  if (entry.audioUrl) return entry.audioUrl;
  return mediaPathToUrl(entry.audioFile) ?? null;
}

/** Phrase keys used in railway-style composed announcements. */
export const PHRASE_KEYS = [
  { key: 'attention', label: 'Attention please', labelMl: 'ശ്രദ്ധിക്കുക' },
  { key: 'nextStop', label: 'The next stop is', labelMl: 'അടുത്ത നിർത്തം' },
  { key: 'pleaseAlight', label: 'Passengers please alight', labelMl: 'യാത്രക്കാർ ഇറങ്ങുക' },
  { key: 'terminus', label: 'This is the final stop', labelMl: 'അവസാന നിർത്തം' },
];

export function stopAudioKey(stop) {
  const en = normalizeStop(stop).en;
  return en ? en.toLowerCase().trim() : '';
}

/** Stop name keys still referenced by any route (shared names keep one audio set). */
export function collectUsedStopAudioKeys(routes = []) {
  const keys = new Set();
  for (const route of routes) {
    for (const stop of getAllStops(route)) {
      const key = stopAudioKey(stop);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/** True when shared phrase clips (attention, next stop, etc.) are recorded. */
export function hasPhraseAudio(state, lang = null) {
  const fragments = state?.audioFragments ?? {};
  for (const { key } of PHRASE_KEYS) {
    const entry = fragments[key] ?? {};
    const langs = lang ? [lang] : ['ml', 'en'];
    for (const code of langs) {
      if (resolveClipUrl(entry[code])) return true;
    }
  }
  return false;
}

/**
 * Build ordered audio URLs for one language block.
 * Skips missing fragments — only plays what is recorded.
 * Stop name clips are optional; shared phrase audio is reused for every stop.
 */
export function buildLanguageSequence({ fragments, stopAudio, stop, lang, isTerminus }) {
  const key = stopAudioKey(stop);
  const urls = [];

  const pushIf = (phraseKey) => {
    const url = resolveClipUrl(fragments?.[phraseKey]?.[lang]);
    if (url) urls.push(url);
  };

  pushIf('attention');
  pushIf('nextStop');

  const nameUrl = resolveClipUrl(stopAudio?.[key]?.[lang]);
  if (nameUrl) urls.push(nameUrl);

  if (isTerminus) {
    pushIf('terminus');
  } else {
    pushIf('pleaseAlight');
  }

  return urls;
}

/**
 * Build full announcement: each language block played in order (e.g. ML then EN).
 * Plays shared phrase clips plus stop name when available — missing stop names are skipped.
 */
export function buildAnnouncementSequence(state, stop, { isTerminus = false } = {}) {
  const { audioFragments = {}, stopAudio = {}, stopVoiceAds = {}, announcementSettings = {} } = state;
  const configuredLangs = announcementSettings.languages ?? ['ml', 'en'];

  const blocks = configuredLangs.map((lang) =>
    buildLanguageSequence({
      fragments: audioFragments,
      stopAudio,
      stop,
      lang,
      isTerminus,
    })
  );

  const pauseMs = announcementSettings.pauseBetweenFragmentsMs ?? 300;

  const flat = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length) flat.push(...blocks[i]);
    if (i < blocks.length - 1 && blocks[i].length && blocks[i + 1].length) {
      flat.push({ pause: pauseMs });
    }
  }

  // Voice ad — one clip per stop (not per-language), managed from the cloud dashboard (its own
  // catalog, state.stopVoiceAds — kept separate from stopAudio so the periodic cloud resync of
  // stop-name clips, which assumes every stopAudio sub-key is {audioFile}-shaped, can't silently
  // wipe it out) and synced down like ads/routes. Appended once at the very end so it plays as
  // the tail of a single continuous announcement rather than being repeated after every
  // language block.
  const key = stopAudioKey(stop);
  const voiceAdEntry = stopVoiceAds?.[key];
  const adUrl = voiceAdEntry?.enabled ? resolveClipUrl(voiceAdEntry) : null;
  if (adUrl && flat.length) {
    flat.push({ pause: pauseMs });
    flat.push(adUrl);
  }

  return flat.filter((item) => typeof item === 'string' || item?.pause);
}

export function hasAnnouncementAudio(state, stop) {
  const seq = buildAnnouncementSequence(state, stop);
  return seq.some((item) => typeof item === 'string');
}

/** Whether an announcement can play for this stop (shared phrases and/or stop name). */
export function canPlayAnnouncement(state, stop) {
  if (!(state?.announcementSettings?.enabled ?? true)) return false;
  return hasPhraseAudio(state) || hasStopNameAudio(state, stop) || hasAnnouncementAudio(state, stop);
}

/** True when this stop has a recorded name clip (with or without phrase fragments). */
export function hasStopNameAudio(state, stop) {
  const key = stopAudioKey(stop);
  if (!key) return false;
  const entry = state.stopAudio?.[key] ?? {};
  for (const lang of state.announcementSettings?.languages ?? ['ml', 'en']) {
    if (resolveClipUrl(entry[lang])) return true;
  }
  return Object.values(entry).some((clip) => resolveClipUrl(clip));
}

/** How many stops on a route have stop name clips recorded. */
export function getRouteAudioSummary(state, route) {
  const stops = getAllStops(route);
  const total = stops.length;
  let withStopNames = 0;
  for (const stop of stops) {
    if (hasStopNameAudio(state, stop)) withStopNames++;
  }
  const phrasesReady = hasPhraseAudio(state);
  return {
    total,
    withAudio: withStopNames,
    withStopNames,
    phrasesReady,
    hasAudio: phrasesReady || withStopNames > 0,
    complete: phrasesReady && total > 0 && withStopNames === total,
  };
}
