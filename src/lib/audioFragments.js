import { normalizeStop, getAllStops } from '../store/busStore';

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

/**
 * Build ordered audio URLs for one language block.
 * Skips missing fragments — only plays what is recorded.
 */
export function buildLanguageSequence({ fragments, stopAudio, stop, lang, isTerminus }) {
  const key = stopAudioKey(stop);
  const urls = [];

  const pushIf = (phraseKey) => {
    const url = fragments?.[phraseKey]?.[lang]?.audioUrl;
    if (url) urls.push(url);
  };

  pushIf('attention');
  pushIf('nextStop');

  const nameUrl = stopAudio?.[key]?.[lang]?.audioUrl;
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
 */
export function buildAnnouncementSequence(state, stop, { isTerminus = false } = {}) {
  const { audioFragments = {}, stopAudio = {}, announcementSettings = {} } = state;
  // Only include languages that have at least one clip for this stop.
  const languages = (announcementSettings.languages ?? ['ml', 'en']).filter((lang) =>
    buildLanguageSequence({
      fragments: audioFragments,
      stopAudio,
      stop,
      lang,
      isTerminus,
    }).length > 0
  );

  const langsToUse = languages.length ? languages : (announcementSettings.languages ?? ['ml', 'en']);

  const pauseMs = announcementSettings.pauseBetweenFragmentsMs ?? 300;

  const blocks = langsToUse.map((lang) =>
    buildLanguageSequence({
      fragments: audioFragments,
      stopAudio,
      stop,
      lang,
      isTerminus,
    })
  );

  const flat = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].length) flat.push(...blocks[i]);
    if (i < blocks.length - 1 && blocks[i].length && blocks[i + 1].length) {
      flat.push({ pause: pauseMs });
    }
  }

  return flat.filter((item) => typeof item === 'string' || item?.pause);
}

export function hasAnnouncementAudio(state, stop) {
  const seq = buildAnnouncementSequence(state, stop);
  return seq.some((item) => typeof item === 'string');
}
