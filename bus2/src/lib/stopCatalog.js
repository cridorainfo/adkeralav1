import { normalizeStop } from '../store/busStore';

export function stopKey(en) {
  return String(en ?? '')
    .trim()
    .toLowerCase();
}

export function findStopInCatalog(catalog = [], en) {
  const key = stopKey(en);
  if (!key) return null;
  return catalog.find((s) => stopKey(s.en) === key) ?? null;
}

/** Merge catalog fields (ml, lat, lng) into a route stop when name matches. */
export function mergeStopWithCatalog(stop, catalog = []) {
  const base = normalizeStop(stop);
  const hit = findStopInCatalog(catalog, base.en);
  if (!hit) return base;
  return normalizeStop({
    ...base,
    ml: base.ml || hit.ml || '',
    lat: base.lat ?? hit.lat ?? null,
    lng: base.lng ?? hit.lng ?? null,
    radiusM: base.radiusM ?? hit.radiusM ?? 80,
  });
}

export function catalogEntryFromStop(stop, { lat, lng } = {}) {
  const n = normalizeStop(stop);
  return {
    en: n.en,
    ml: n.ml || '',
    lat: lat ?? n.lat ?? null,
    lng: lng ?? n.lng ?? null,
    radiusM: n.radiusM ?? 80,
    updatedAt: Date.now(),
  };
}

export function upsertCatalogEntry(catalog = [], entry) {
  const next = catalogEntryFromStop(entry, entry);
  if (!next.en) return catalog;
  const key = stopKey(next.en);
  const idx = catalog.findIndex((s) => stopKey(s.en) === key);
  if (idx >= 0) {
    const merged = normalizeStop({ ...catalog[idx], ...next, en: catalog[idx].en || next.en });
    const copy = [...catalog];
    copy[idx] = { ...merged, updatedAt: Date.now() };
    return copy;
  }
  return [...catalog, next];
}

export function searchCatalog(catalog = [], query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return catalog.slice(0, 40);
  return catalog.filter(
    (s) =>
      s.en?.toLowerCase().includes(q) ||
      s.ml?.toLowerCase().includes(q)
  ).slice(0, 20);
}

/** Collect unique stops from all routes into catalog entries. */
export function buildCatalogFromRoutes(routes = []) {
  let catalog = [];
  for (const route of routes) {
    const stops = [route.startStop, ...(route.stops ?? []), route.endStop].filter(Boolean);
    for (const stop of stops) {
      catalog = upsertCatalogEntry(catalog, stop);
    }
  }
  return catalog;
}
