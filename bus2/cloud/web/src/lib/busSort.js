import { busDisplayLabel } from '../components/BusContext.jsx';

/** Stable alphabetical order by display label (falls back to busId to break ties) — used
 * everywhere a bus list is rendered so the order doesn't visibly reshuffle on every ~4-5s poll as
 * buses report telemetry in a different sequence each time. A jumping list is merely annoying at
 * a dozen buses; at the hundreds-to-1000-vehicle scale this fleet is headed toward, an unstable
 * order makes the list unscannable — so sort is applied unconditionally, not just as a search
 * fallback. */
export function sortBusesAlphabetically(buses = []) {
  return [...buses].sort((a, b) => {
    const cmp = busDisplayLabel(a).localeCompare(busDisplayLabel(b), undefined, {
      sensitivity: 'base',
      numeric: true,
    });
    return cmp !== 0 ? cmp : String(a.busId ?? '').localeCompare(String(b.busId ?? ''));
  });
}

/** Case-insensitive substring match against name/plate/busId/label — the same fields
 * busDisplayLabel itself can surface, so "search matches what you see" holds. */
export function filterBusesBySearch(buses = [], query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return buses;
  return buses.filter((bus) => {
    const plate = (bus.profile?.plateDisplay || bus.profile?.plate || '').toLowerCase();
    const name = (bus.profile?.displayName || '').toLowerCase();
    const id = (bus.busId || '').toLowerCase();
    const label = busDisplayLabel(bus).toLowerCase();
    return plate.includes(q) || name.includes(q) || id.includes(q) || label.includes(q);
  });
}
