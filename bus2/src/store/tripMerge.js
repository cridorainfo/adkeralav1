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

  copyTripFields(source, base);
  base.savedAt = Math.max(current.savedAt ?? 0, incoming.savedAt ?? 0, base.savedAt ?? 0);
  return base;
}

export function copyTripFields(source = {}, base = {}) {
  for (const key of TRIP_FIELDS) {
    if (source[key] !== undefined) base[key] = source[key];
  }
  return base;
}

/**
 * Merge trip when applying db/info.txt poll — remote wins on newer revision,
 * or same revision with newer/equal savedAt (admin disconnect / direction reset).
 * Local wins on stale poll with lower driveRevision (display ahead of disk write).
 */
export function mergeTripFieldsFromSync(prev = {}, stored = {}, base = {}) {
  const curRev = prev.driveRevision ?? 0;
  const incRev = stored.driveRevision ?? 0;
  const prevSaved = prev.savedAt ?? 0;
  const remoteSaved = stored.savedAt ?? 0;

  if (incRev > curRev) {
    copyTripFields(stored, base);
  } else if (curRev > incRev) {
    resolveTripFields(prev, stored, base);
  } else if (remoteSaved >= prevSaved) {
    copyTripFields(stored, base);
  } else {
    resolveTripFields(prev, stored, base);
  }

  base.savedAt = Math.max(prevSaved, remoteSaved, base.savedAt ?? 0);
  return base;
}
