/** Generate a stable unique route id (names and endpoints may repeat). */
export function createRouteId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `route-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `route-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function routeStopCount(route) {
  return 2 + (route?.stops?.length ?? 0);
}

export function routeEndpointsLabel(route) {
  const start = route?.startStop?.en?.trim() || '—';
  const end = route?.endStop?.en?.trim() || '—';
  return `${start} → ${end}`;
}

/** Dropdown / table label — includes unique id so duplicate names are distinguishable. */
export function routeSelectLabel(route) {
  const name = route?.name?.trim() || 'Unnamed route';
  const id = route?.id || '—';
  return `${name} · ${routeEndpointsLabel(route)} · ${routeStopCount(route)} stops · ${id}`;
}

export function routeViaStopsSummary(route, max = 4) {
  const middle = (route?.stops ?? []).map((s) => s?.en?.trim()).filter(Boolean);
  if (!middle.length) return '';
  if (middle.length <= max) return middle.join(', ');
  return `${middle.slice(0, max).join(', ')} +${middle.length - max} more`;
}
