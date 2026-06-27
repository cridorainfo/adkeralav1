import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getAllStops } from '../src/store/busStore.js';

const AUDIO_EXT = /\.(webm|mp3|wav|ogg|m4a|aac)$/i;

function normalizeKey(name) {
  return String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasClip(entry) {
  return Boolean(entry?.audioFile || entry?.audioUrl);
}

/** Build map of normalized stop name → canonical stopAudio key. */
function collectStopKeyAliases(state) {
  const aliases = new Map();

  const register = (en) => {
    if (!en) return;
    const canonical = en.toLowerCase().trim();
    aliases.set(canonical, canonical);
    aliases.set(normalizeKey(en), canonical);
  };

  for (const route of state.routes ?? []) {
    for (const stop of getAllStops(route)) register(stop.en);
  }
  for (const stop of state.stopCatalog ?? []) register(stop.en);
  for (const key of Object.keys(state.stopAudio ?? {})) {
    aliases.set(key, key);
    aliases.set(normalizeKey(key), key);
  }

  return aliases;
}

function resolveCanonicalKey(rawKey, aliases) {
  if (!rawKey) return null;
  return aliases.get(rawKey) ?? aliases.get(normalizeKey(rawKey)) ?? rawKey;
}

/** Parse db/media/stops filename into stop key + language. */
export function parseStopAudioFilename(filename) {
  const base = String(filename)
    .replace(/^\d+-/, '')
    .replace(AUDIO_EXT, '');

  const langMatch = base.match(/_(en|ml)$/i);
  if (langMatch) {
    const lang = langMatch[1].toLowerCase();
    const stopPart = base.slice(0, -langMatch[0].length);
    return { stopKey: normalizeKey(stopPart), lang };
  }

  return { stopKey: normalizeKey(base), lang: 'en' };
}

/**
 * Link orphaned files under db/media/stops/ into stopAudio when info.txt
 * has files on disk but no (or incomplete) stopAudio entries.
 */
export async function reconcileStopAudioFromDisk(root, state) {
  if (!state || typeof state !== 'object') return { state, changed: false };

  const stopsDir = path.join(root, 'db', 'media', 'stops');
  if (!existsSync(stopsDir)) return { state, changed: false };

  const files = (await fs.readdir(stopsDir).catch(() => [])).filter((f) => AUDIO_EXT.test(f));
  if (!files.length) return { state, changed: false };

  const aliases = collectStopKeyAliases(state);
  const stopAudio = { ...(state.stopAudio ?? {}) };
  let changed = false;

  for (const file of files) {
    const { stopKey, lang } = parseStopAudioFilename(file);
    const canonicalKey = resolveCanonicalKey(stopKey, aliases);
    if (!canonicalKey) continue;

    const relPath = `stops/${file}`;
    const entry = { ...(stopAudio[canonicalKey] ?? {}) };
    if (hasClip(entry[lang])) continue;

    entry[lang] = { audioFile: relPath };
    stopAudio[canonicalKey] = entry;
    aliases.set(canonicalKey, canonicalKey);
    aliases.set(normalizeKey(canonicalKey), canonicalKey);
    changed = true;
  }

  if (!changed) return { state, changed: false };
  return { state: { ...state, stopAudio }, changed: true };
}
