import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { PHRASE_KEYS } from '../src/lib/audioFragments.js';

const AUDIO_EXT = /\.(webm|mp3|wav|ogg|m4a|aac)$/i;

const PHRASE_KEY_ALIASES = new Map(
  PHRASE_KEYS.flatMap(({ key }) => [
    [key.toLowerCase(), key],
    [key.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, ''), key],
  ])
);

function hasClip(entry) {
  return Boolean(entry?.audioFile || entry?.audioUrl);
}

/** Parse db/media/announcements filename into phrase key + language. */
export function parsePhraseAudioFilename(filename) {
  const base = String(filename)
    .replace(/^\d+-/, '')
    .replace(AUDIO_EXT, '');

  const langMatch = base.match(/_(en|ml)$/i);
  if (!langMatch) return null;

  const lang = langMatch[1].toLowerCase();
  const phrasePart = base.slice(0, -langMatch[0].length);
  const phraseKey =
    PHRASE_KEY_ALIASES.get(phrasePart.toLowerCase()) ??
    PHRASE_KEY_ALIASES.get(phrasePart.replace(/-/g, '').toLowerCase());

  if (!phraseKey) return null;
  return { phraseKey, lang };
}

/**
 * Link shared phrase clips under db/media/announcements/ into audioFragments.
 * These phrases are the same for every route and stop on the bus.
 */
export async function reconcilePhraseAudioFromDisk(root, state) {
  if (!state || typeof state !== 'object') return { state, changed: false };

  const phrasesDir = path.join(root, 'db', 'media', 'announcements');
  if (!existsSync(phrasesDir)) return { state, changed: false };

  const files = (await fs.readdir(phrasesDir).catch(() => [])).filter((f) => AUDIO_EXT.test(f));
  if (!files.length) return { state, changed: false };

  const audioFragments = { ...(state.audioFragments ?? {}) };
  let changed = false;

  for (const file of files) {
    const parsed = parsePhraseAudioFilename(file);
    if (!parsed) continue;

    const { phraseKey, lang } = parsed;
    const relPath = `announcements/${file}`;
    const entry = { ...(audioFragments[phraseKey] ?? {}) };
    if (hasClip(entry[lang])) continue;

    entry[lang] = { audioFile: relPath };
    audioFragments[phraseKey] = entry;
    changed = true;
  }

  if (!changed) return { state, changed: false };
  return { state: { ...state, audioFragments }, changed: true };
}
