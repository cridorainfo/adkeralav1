import { dedupeRoutes, mergeRoutesForSync } from '../src/store/busStore.js';
import { mergeAudioMap } from './audioMerge.js';
import { resolveTripFields } from '../src/store/tripMerge.js';
import { mergeBusProfile } from '../src/store/busProfileMerge.js';

function mergeCatalogs(current = [], incoming = []) {
  const byKey = new Map();
  const add = (entry) => {
    const key = String(entry?.en ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    byKey.set(key, { ...(byKey.get(key) ?? {}), ...entry, en: entry.en ?? byKey.get(key)?.en });
  };
  for (const entry of current) add(entry);
  for (const entry of incoming) add(entry);
  return [...byKey.values()];
}

/** Keep an in-flight passenger ad playing when control phone saves GPS/trip without ending the ad. */
function mergeDisplayPlayback(current = {}, incoming = {}, base = {}) {
  const curLastAdEnd = current.lastAdEndedAt ?? 0;
  const incLastAdEnd = incoming.lastAdEndedAt ?? 0;
  const curAdStarted = current.adStartedAt ?? 0;
  const incAdStarted = incoming.adStartedAt ?? 0;
  const adPlayingOnBus = current.displayView === 'ad';
  const routeOnBus = current.displayView !== 'ad';
  const incomingEndedAd = incoming.displayView !== 'ad' && incLastAdEnd > curLastAdEnd;
  const incomingStartedAd =
    incoming.displayView === 'ad' &&
    incAdStarted > curAdStarted &&
    (routeOnBus ? incAdStarted > curLastAdEnd : true);

  if (incomingEndedAd) {
    base.displayView = incoming.displayView ?? 'route';
    if (incoming.currentAdIndex != null) base.currentAdIndex = incoming.currentAdIndex;
    if (incoming.nextAdIndex != null) base.nextAdIndex = incoming.nextAdIndex;
    base.lastAdEndedAt = incLastAdEnd;
    base.adStartedAt = null;
    return;
  }

  if (incomingStartedAd) {
    base.displayView = 'ad';
    if (incoming.currentAdIndex != null) base.currentAdIndex = incoming.currentAdIndex;
    if (incoming.nextAdIndex != null) base.nextAdIndex = incoming.nextAdIndex;
    base.adStartedAt = incoming.adStartedAt;
    return;
  }

  if (adPlayingOnBus) {
    base.displayView = current.displayView;
    base.currentAdIndex = current.currentAdIndex ?? 0;
    base.nextAdIndex = current.nextAdIndex ?? 0;
    base.lastAdEndedAt = curLastAdEnd;
    base.adStartedAt = current.adStartedAt ?? null;
    return;
  }

  if (routeOnBus && curLastAdEnd > incLastAdEnd) {
    base.displayView = 'route';
    base.adStartedAt = null;
    base.lastAdEndedAt = curLastAdEnd;
  }
}

/** Driver link is set only by /api/driver/* — control phone saves must not wipe it. */
function mergeDriverLink(current = {}, incoming = {}, base = {}) {
  const incId = incoming.driverLink?.driverId ?? null;
  const curId = current.driverLink?.driverId ?? null;
  if (incId) {
    base.driverLink = incoming.driverLink;
  } else if (curId) {
    base.driverLink = current.driverLink;
  } else {
    base.driverLink = incoming.driverLink ?? current.driverLink ?? null;
  }
}

function mergeBusProfileOntoState(current = {}, incoming = {}, base = {}) {
  base.busProfile = mergeBusProfile(current.busProfile, incoming.busProfile ?? base.busProfile);
}

/** Merge a client POST body onto db/info.txt without dropping routes by accident. */
export function mergeIncomingState(current = {}, incoming = {}) {
  const curSaved = current.savedAt ?? 0;
  const incSaved = incoming.savedAt ?? 0;
  const remoteIsNewer = incSaved >= curSaved;

  const curRoutes = dedupeRoutes(current.routes ?? []);
  const incRoutes = dedupeRoutes(incoming.routes ?? []);
  const routes = mergeRoutesForSync(curRoutes, incRoutes, curSaved, incSaved);

  const base = remoteIsNewer ? { ...current, ...incoming } : { ...incoming, ...current };
  base.routes = routes;
  base.stopCatalog = mergeCatalogs(current.stopCatalog, incoming.stopCatalog);
  base.audioFragments = mergeAudioMap(current.audioFragments, incoming.audioFragments);
  base.stopAudio = mergeAudioMap(current.stopAudio, incoming.stopAudio);
  mergeDisplayPlayback(current, incoming, base);

  if (base.activeRouteId && !routes.some((r) => r.id === base.activeRouteId)) {
    base.activeRouteId = routes[0]?.id ?? null;
  }

  base.savedAt = Math.max(curSaved, incSaved);
  base.lastCloudPushAt = Math.max(current.lastCloudPushAt ?? 0, incoming.lastCloudPushAt ?? 0);
  resolveTripFields(current, incoming, base);
  mergeDriverLink(current, incoming, base);
  mergeBusProfileOntoState(current, incoming, base);
  return base;
}
