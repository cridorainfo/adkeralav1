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

/** Merge catalog GPS/names into route stop fields for display or save. */
export function mergeStopWithCatalog(stop, catalog = []) {
  const en = String(stop?.en ?? '').trim();
  const hit = findStopInCatalog(catalog, en);
  if (!hit) {
    return {
      en,
      ml: String(stop?.ml ?? '').trim(),
      lat: stop?.lat ?? '',
      lng: stop?.lng ?? '',
      radiusM: stop?.radiusM ?? 80,
    };
  }
  return {
    ...stop,
    en: en || hit.en || '',
    ml: String(stop?.ml ?? '').trim() || hit.ml || '',
    lat: stop?.lat ?? hit.lat ?? '',
    lng: stop?.lng ?? hit.lng ?? '',
    radiusM: stop?.radiusM ?? hit.radiusM ?? 80,
  };
}

export function attachCatalogGpsToRoute(route, catalog = []) {
  if (!route) return route;
  const merge = (stop) => mergeStopWithCatalog(stop ?? {}, catalog);
  return {
    ...route,
    startStop: merge(route.startStop),
    endStop: merge(route.endStop),
    stops: (route.stops ?? []).map(merge),
  };
}
