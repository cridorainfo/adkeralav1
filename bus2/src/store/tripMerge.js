/** Trip + route fields — driveRevision picks the authoritative snapshot on merge. */
export const TRIP_FIELDS = [
  'activeRouteId',
  'currentStopIndex',
  'tripStarted',
  'tripEnded',
  'tripDeparted',
  'routeDirection',
  'driveRevision',
];

export function nextDriveRevision(state) {
  return (state?.driveRevision ?? 0) + 1;
}

/** Pick authoritative trip snapshot when merging two persisted states. */
export function resolveTripFields(current = {}, incoming = {}, base = {}) {
  const curRev = current.driveRevision ?? 0;
  const incRev = incoming.driveRevision ?? 0;
  let source = current;

  if (incRev > curRev) source = incoming;
  else if (curRev > incRev) source = current;
  else {
    source = (incoming.savedAt ?? 0) >= (current.savedAt ?? 0) ? incoming : current;
  }

  for (const key of TRIP_FIELDS) {
    if (source[key] !== undefined) base[key] = source[key];
  }

  base.savedAt = Math.max(current.savedAt ?? 0, incoming.savedAt ?? 0, base.savedAt ?? 0);
  return base;
}
