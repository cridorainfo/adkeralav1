/** Align bus stopAudio with cloud catalog — drops clips the cloud removed. */
export function syncStopAudioWithCatalog(busStopAudio = {}, cloudCatalog = {}) {
  const out = { ...(busStopAudio ?? {}) };
  for (const key of Object.keys(busStopAudio ?? {})) {
    const cloudEntry = cloudCatalog[key];
    if (!cloudEntry) {
      delete out[key];
      continue;
    }
    const langs = { ...(out[key] ?? {}) };
    for (const lang of Object.keys(langs)) {
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
