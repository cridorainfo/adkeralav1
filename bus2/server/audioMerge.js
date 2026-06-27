/** Union-merge audio clip maps without dropping existing entries. */
export function mergeAudioMap(existing = {}, incoming = {}) {
  const out = { ...(existing ?? {}) };
  for (const [key, langs] of Object.entries(incoming ?? {})) {
    out[key] = { ...(out[key] ?? {}) };
    for (const [lang, val] of Object.entries(langs ?? {})) {
      if (val && typeof val === 'object') {
        out[key][lang] = { ...(out[key][lang] ?? {}), ...val };
      }
    }
  }
  return out;
}
