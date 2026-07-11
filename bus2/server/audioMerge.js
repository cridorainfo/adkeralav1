/**
 * Align bus stopAudio with cloud catalog: pulls down stops/languages the cloud has that this
 * bus hasn't seen yet, updates ones both sides know about, and drops clips the cloud removed.
 *
 * Previously this only walked Object.keys(busStopAudio) — i.e. keys the bus already had — so a
 * stop recorded for the first time on the cloud dashboard (never before present locally) was
 * silently skipped forever instead of being downloaded, even though routes/ads sync fine. Same
 * bug for a *new* language added to a stop the bus already partially had. Confirmed live: audio
 * added for stops on the Kilimanoor-Kadakkal-Madathara route (e.g. Mottakuzhy) never reached the
 * bus, so pressing forward/announcement played nothing for those stops.
 */
export function syncStopAudioWithCatalog(busStopAudio = {}, cloudCatalog = {}) {
  const out = { ...(busStopAudio ?? {}) };
  const allKeys = new Set([...Object.keys(busStopAudio ?? {}), ...Object.keys(cloudCatalog ?? {})]);
  for (const key of allKeys) {
    const cloudEntry = cloudCatalog[key];
    if (!cloudEntry) {
      delete out[key];
      continue;
    }
    const langs = { ...(out[key] ?? {}) };
    const allLangs = new Set([...Object.keys(langs), ...Object.keys(cloudEntry)]);
    for (const lang of allLangs) {
      const cloudFile = cloudEntry[lang]?.audioFile;
      if (!cloudFile) delete langs[lang];
      else langs[lang] = { ...langs[lang], audioFile: cloudFile };
    }
    if (Object.keys(langs).length) out[key] = langs;
    else delete out[key];
  }
  return out;
}

/** Union-merge audio clip maps; supports removal via null audioFile. */
export function mergeAudioMap(existing = {}, incoming = {}) {
  const out = { ...(existing ?? {}) };
  for (const [key, langs] of Object.entries(incoming ?? {})) {
    out[key] = { ...(out[key] ?? {}) };
    for (const [lang, val] of Object.entries(langs ?? {})) {
      const shouldRemove =
        val === null || val?.remove === true || val?.audioFile === null || val?.audioFile === '';
      if (shouldRemove) {
        delete out[key][lang];
        continue;
      }
      if (val && typeof val === 'object') {
        out[key][lang] = { ...(out[key][lang] ?? {}), ...val };
      }
    }
    if (!Object.keys(out[key]).length) delete out[key];
  }
  return out;
}
