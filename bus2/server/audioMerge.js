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
