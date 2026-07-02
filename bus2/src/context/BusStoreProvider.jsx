import { useCallback, useEffect, useRef, useState } from 'react';
import { BusStoreContext } from './BusStoreContext.js';
import {
  loadStateAsync,
  saveState,
  subscribe,
  setPersistenceReady,
  isPersistenceReady,
  createId,
  getActiveRoute,
  getAllStops,
  getStopInfo,
  getTripStartIndex,
  normalizeRouteMiddleStops,
  dedupeRoutes,
  normalizeStop,
  sameStop,
  mergeRemoteState,
  defaultState,
  isDbWriteInFlight,
  hasPendingDbWrites,
  syncLocalCacheFromServer,
} from '../store/busStore';
import { createRouteId } from '../lib/routeLabels';
import {
  uploadDataUrl,
  collectUsedAdMediaPaths,
  deleteUnusedAdMedia,
  deleteMediaPaths,
  mediaUrlToPath,
  pruneStopAudioMap,
} from '../lib/fileStorage';
import { collectUsedStopAudioKeys } from '../lib/audioFragments';
import { runAnnouncementPlayback } from '../lib/runAnnouncementPlayback';
import { isDisplayRole } from '../lib/appRole';
import { nextPlayableAdIndex, adHasPlayableMedia } from '../lib/adPlayback';
import {
  mergeStopWithCatalog,
  upsertCatalogEntry,
  catalogEntryFromStop,
} from '../lib/stopCatalog';
import {
  applyStartTrip,
  applyEndTrip,
  applyMoveForward,
  applyRequestAnnouncement,
  applySelectRoute,
  applySetRouteDirection,
  applyUndoForward,
} from '../store/driveActions';

function useBusStoreLogic() {
  const [state, setState] = useState(defaultState);
  const [storageError, setStorageError] = useState(null);
  const stateRef = useRef(state);
  const lastWriteAtRef = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    const onSaveError = (e) => {
      setStorageError(e.detail?.message ?? 'Could not save to bus');
    };
    window.addEventListener('adkerala-save-error', onSaveError);
    return () => window.removeEventListener('adkerala-save-error', onSaveError);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPersistenceReady(false);
    loadStateAsync()
      .then((stored) => {
        if (cancelled || typeof stored !== 'object' || stored === null) return;
        setState(stored);
        setPersistenceReady(true);
        lastWriteAtRef.current = stored.savedAt ?? 0;
      })
      .catch(() => {
        if (!cancelled) setPersistenceReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      subscribe((incoming) => {
        setState((prev) => (typeof incoming === 'function' ? incoming(prev) : incoming));
      }),
    []
  );

  useEffect(() => {
    setState((prev) => {
      try {
        if (!isPersistenceReady()) return prev;
        const routes = dedupeRoutes(prev.routes);
        if (JSON.stringify(routes) === JSON.stringify(prev.routes)) return prev;
        const next = { ...prev, routes };
        const result = saveState(next);
        if (!result.ok) {
          setTimeout(() => setStorageError(result.error), 0);
          return prev;
        }
        setTimeout(() => setStorageError(null), 0);
        return next;
      } catch (err) {
        console.warn('AdKerala: route normalization failed.', err);
        return prev;
      }
    });
  }, []);

  useEffect(() => {
    const flush = () => {
      if (!isPersistenceReady()) return;
      saveState(stateRef.current, { force: true });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const update = useCallback((patch) => {
    setState((prev) => {
      try {
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        if (next === prev) return prev;
        const stamped = { ...next, savedAt: Date.now() };
        lastWriteAtRef.current = stamped.savedAt;
        stateRef.current = stamped;
        const result = saveState(stamped);
        if (!result.ok) {
          setTimeout(() => setStorageError(result.error), 0);
          return prev;
        }
        setTimeout(() => setStorageError(null), 0);
        return stamped;
      } catch (err) {
        console.warn('AdKerala: state update failed.', err);
        return prev;
      }
    });
  }, []);

  const clearStorageError = useCallback(() => setStorageError(null), []);

  const applyRemoteState = useCallback((remoteHydrated) => {
    setState((prev) => {
      if (!isPersistenceReady()) return prev;

      const remoteRev = remoteHydrated?.driveRevision ?? 0;
      const prevRev = prev?.driveRevision ?? 0;
      const tripAdvanced = remoteRev > prevRev;
      const announceNew =
        Boolean(remoteHydrated?.announcementRequest?.id) &&
        remoteHydrated.announcementRequest.id !== prev?.announcementRequest?.id;

      if (!tripAdvanced && !announceNew) {
        if (isDbWriteInFlight() || hasPendingDbWrites()) return prev;

        const blockedByRecentLocalWrite =
          Date.now() - lastWriteAtRef.current < 8000 &&
          lastWriteAtRef.current >= (remoteHydrated?.savedAt ?? 0);
        const localTripAhead = prevRev > remoteRev;
        if (blockedByRecentLocalWrite || localTripAhead) {
          const remoteRuntimeAt = remoteHydrated?.serialRuntime?.at ?? 0;
          const prevRuntimeAt = prev?.serialRuntime?.at ?? 0;
          if (remoteRuntimeAt > prevRuntimeAt && remoteHydrated?.serialRuntime) {
            return { ...prev, serialRuntime: remoteHydrated.serialRuntime };
          }
          return prev;
        }
      }

      const merged = mergeRemoteState(prev, remoteHydrated);
      delete merged._cloudPushAdvanced;

      if (prev?.announcementRequest?.id && !merged.announcementRequest?.id) {
        merged.announcementRequest = prev.announcementRequest;
      }
      merged.announcementStatus = prev.announcementStatus;

      const localGpsAt = prev.driverLocation?.at ?? 0;
      const remoteGpsAt = remoteHydrated.driverLocation?.at ?? 0;
      if (localGpsAt > remoteGpsAt) {
        merged.driverLocation = prev.driverLocation;
      }

      if (isDisplayRole()) {
        const remoteEndedAd =
          remoteHydrated.displayView !== 'ad' &&
          (remoteHydrated.lastAdEndedAt ?? 0) > (prev.lastAdEndedAt ?? 0);
        const remoteStartedAd =
          remoteHydrated.displayView === 'ad' &&
          (remoteHydrated.adStartedAt ?? 0) > (prev.lastAdEndedAt ?? 0) &&
          (remoteHydrated.adStartedAt ?? 0) > (prev.adStartedAt ?? 0);
        const localEndedAd =
          prev.displayView !== 'ad' &&
          (prev.lastAdEndedAt ?? 0) > (remoteHydrated.lastAdEndedAt ?? 0);

        if (prev.displayView === 'ad') {
          if (!remoteEndedAd && !remoteStartedAd) {
            merged.displayView = prev.displayView;
            merged.currentAdIndex = prev.currentAdIndex;
            merged.nextAdIndex = prev.nextAdIndex;
            merged.lastAdEndedAt = prev.lastAdEndedAt;
            merged.adStartedAt = prev.adStartedAt;
          }
        } else if (localEndedAd && !remoteStartedAd) {
          merged.displayView = prev.displayView;
          merged.currentAdIndex = prev.currentAdIndex;
          merged.nextAdIndex = prev.nextAdIndex;
          merged.lastAdEndedAt = prev.lastAdEndedAt;
          merged.adStartedAt = prev.adStartedAt;
        }
      }

      syncLocalCacheFromServer(merged);

      return merged;
    });
  }, []);

  /** Apply server-written state and persist locally so added routes stay until removed. */
  const commitServerState = useCallback((remoteHydrated) => {
    if (!remoteHydrated || typeof remoteHydrated !== 'object') return;
    setState((prev) => {
      const merged = mergeRemoteState(prev, remoteHydrated);
      if (prev?.announcementRequest?.id && !merged.announcementRequest?.id) {
        merged.announcementRequest = prev.announcementRequest;
      }
      merged.announcementStatus = prev.announcementStatus;
      const savedAt = merged.savedAt ?? Date.now();
      lastWriteAtRef.current = savedAt;
      saveState({ ...merged, savedAt }, { force: true });
      return merged;
    });
  }, []);

  const updateDriverLocation = useCallback((location, persist = false) => {
    setState((prev) => {
      const next = { ...prev, driverLocation: location };
      if (!persist) {
        stateRef.current = next;
        return next;
      }
      const stamped = { ...next, savedAt: prev.savedAt ?? Date.now() };
      stateRef.current = stamped;
      saveState(stamped);
      return stamped;
    });
  }, []);

  const clearAnnouncementRequest = useCallback(() => {
    update((s) => (s.announcementRequest ? { ...s, announcementRequest: null } : s));
  }, [update]);

  const setAnnouncementStatus = useCallback((status) => {
    setState((prev) =>
      prev.announcementStatus === status ? prev : { ...prev, announcementStatus: status }
    );
  }, []);

  const playAnnouncementNow = useCallback(
    (stateAfter) => {
      if (!isDisplayRole()) return;
      runAnnouncementPlayback(stateAfter, {
        onStart: () => setAnnouncementStatus('playing'),
        onEnd: () => {
          setAnnouncementStatus(null);
          clearAnnouncementRequest();
        },
        onEmpty: () => clearAnnouncementRequest(),
      });
    },
    [clearAnnouncementRequest, setAnnouncementStatus]
  );

  const addRoute = useCallback(
    (name, startEn, endEn, startMl = '', endMl = '') => {
      const catalog = stateRef.current.stopCatalog ?? [];
      const route = {
        id: createRouteId(),
        name,
        startStop: mergeStopWithCatalog({ en: startEn.trim(), ml: startMl.trim() }, catalog),
        endStop: mergeStopWithCatalog({ en: endEn.trim(), ml: endMl.trim() }, catalog),
        stops: [],
      };
      update((s) => ({
        ...s,
        routes: [...s.routes, route],
        activeRouteId: route.id,
        currentStopIndex: 0,
        tripStarted: false,
        tripEnded: false,
        tripDeparted: false,
        routeDirection: 'forward',
      }));
      return route.id;
    },
    [update]
  );

  const importRoute = useCallback(
    (route, { activate = true } = {}) => {
      if (!route?.name || !route?.startStop?.en || !route?.endStop?.en) return null;

      const catalog = stateRef.current.stopCatalog ?? [];
      const normalized = normalizeRouteMiddleStops({
        id: route.id ?? createId(),
        name: route.name,
        startStop: mergeStopWithCatalog(normalizeStop(route.startStop), catalog),
        endStop: mergeStopWithCatalog(normalizeStop(route.endStop), catalog),
        stops: (route.stops ?? []).map((s) => mergeStopWithCatalog(normalizeStop(s), catalog)),
      });

      let catalogNext = catalog;
      for (const stop of [
        normalized.startStop,
        ...(normalized.stops ?? []),
        normalized.endStop,
      ]) {
        if (stop?.en) catalogNext = upsertCatalogEntry(catalogNext, stop);
      }

      update((s) => {
        const exists = s.routes.some((r) => r.id === normalized.id);
        const routes = exists
          ? s.routes.map((r) => (r.id === normalized.id ? normalized : r))
          : [...s.routes, normalized];

        return {
          ...s,
          routes: dedupeRoutes(routes),
          stopCatalog: catalogNext,
          activeRouteId: activate ? normalized.id : s.activeRouteId,
          currentStopIndex: activate ? 0 : s.currentStopIndex,
          tripStarted: activate ? false : s.tripStarted,
          tripEnded: activate ? false : s.tripEnded,
          tripDeparted: activate ? false : s.tripDeparted,
          routeDirection: 'forward',
        };
      });

      return normalized.id;
    },
    [update]
  );

  const updateRoute = useCallback(
    (id, data) => {
      const prev = stateRef.current;
      const nextRoutes = prev.routes.map((r) => (r.id === id ? { ...r, ...data } : r));
      const { nextStopAudio, removedPaths } = pruneStopAudioMap(
        prev.stopAudio,
        collectUsedStopAudioKeys(nextRoutes)
      );

      update((s) => ({
        ...s,
        routes: nextRoutes,
        stopAudio: nextStopAudio,
      }));

      deleteMediaPaths(removedPaths);
    },
    [update]
  );

  const deleteRoute = useCallback(
    (id) => {
      const prev = stateRef.current;
      const nextRoutes = prev.routes.filter((r) => r.id !== id);
      const { nextStopAudio, removedPaths } = pruneStopAudioMap(
        prev.stopAudio,
        collectUsedStopAudioKeys(nextRoutes)
      );

      update((s) => ({
        ...s,
        routes: nextRoutes,
        activeRouteId: s.activeRouteId === id ? null : s.activeRouteId,
        stopAudio: nextStopAudio,
      }));

      deleteMediaPaths(removedPaths);
    },
    [update]
  );

  const addStop = useCallback(
    (routeId, stopEn, stopMl = '', extra = {}) => {
      const trimmed = stopEn.trim();
      if (!trimmed) return false;

      const catalog = stateRef.current.stopCatalog ?? [];
      const newStop = mergeStopWithCatalog(
        { en: trimmed, ml: stopMl.trim(), ...extra },
        catalog
      );

      update((s) => {
        const current = s.routes.find((r) => r.id === routeId);
        if (!current) return s;
        if (getAllStops(current).some((stop) => sameStop(stop, newStop))) return s;

        let catalog = s.stopCatalog ?? [];
        if (newStop.en) {
          catalog = upsertCatalogEntry(catalog, newStop);
        }

        return {
          ...s,
          stopCatalog: catalog,
          routes: s.routes.map((r) =>
            r.id === routeId
              ? normalizeRouteMiddleStops({ ...r, stops: [...(r.stops ?? []), newStop] })
              : r
          ),
        };
      });
      return true;
    },
    [update]
  );

  const updateStopMalayalam = useCallback(
    (routeId, target, ml) => {
      update((s) => ({
        ...s,
        routes: s.routes.map((r) => {
          if (r.id !== routeId) return r;
          const value = ml.trim();

          if (target === 'start') {
            return { ...r, startStop: { ...normalizeStop(r.startStop), ml: value } };
          }
          if (target === 'end') {
            return { ...r, endStop: { ...normalizeStop(r.endStop), ml: value } };
          }

          const stops = [...(r.stops ?? [])];
          if (typeof target !== 'number' || target < 0 || target >= stops.length) return r;
          stops[target] = { ...normalizeStop(stops[target]), ml: value };
          return { ...r, stops };
        }),
      }));
    },
    [update]
  );

  const mergeStopCatalog = useCallback(
    (entries = []) => {
      if (!entries.length) return;
      update((s) => {
        let catalog = s.stopCatalog ?? [];
        for (const entry of entries) {
          catalog = upsertCatalogEntry(catalog, entry);
        }
        return { ...s, stopCatalog: catalog };
      });
    },
    [update]
  );

  const upsertStopInCatalog = useCallback(
    (stopData) => {
      const entry = catalogEntryFromStop(stopData, stopData);
      update((s) => ({
        ...s,
        stopCatalog: upsertCatalogEntry(s.stopCatalog ?? [], entry),
      }));

      fetch('/api/cloud/stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});

      return entry;
    },
    [update]
  );

  const updateStopLocation = useCallback(
    (routeId, target, coords) => {
      const { lat, lng, radiusM = 80 } = coords ?? {};
      let stopToSync = null;

      update((s) => {
        const routes = s.routes.map((r) => {
          if (r.id !== routeId) return r;

          if (target === 'start') {
            stopToSync = { ...normalizeStop(r.startStop), lat, lng, radiusM };
            return { ...r, startStop: stopToSync };
          }
          if (target === 'end') {
            stopToSync = { ...normalizeStop(r.endStop), lat, lng, radiusM };
            return { ...r, endStop: stopToSync };
          }

          const stops = [...(r.stops ?? [])];
          if (typeof target !== 'number' || target < 0 || target >= stops.length) return r;
          stopToSync = { ...normalizeStop(stops[target]), lat, lng, radiusM };
          stops[target] = stopToSync;
          return { ...r, stops };
        });

        let catalog = s.stopCatalog ?? [];
        if (stopToSync?.en) {
          catalog = upsertCatalogEntry(catalog, stopToSync);
        }
        return { ...s, routes, stopCatalog: catalog };
      });

      if (stopToSync?.en) {
        fetch('/api/cloud/stops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stopToSync),
        }).catch(() => {});
      }
    },
    [update]
  );

  const removeStop = useCallback(
    (routeId, stopIndex) => {
      const prev = stateRef.current;
      const nextRoutes = prev.routes.map((r) =>
        r.id === routeId
          ? normalizeRouteMiddleStops({
              ...r,
              stops: (r.stops ?? []).filter((_, i) => i !== stopIndex),
            })
          : r
      );
      const { nextStopAudio, removedPaths } = pruneStopAudioMap(
        prev.stopAudio,
        collectUsedStopAudioKeys(nextRoutes)
      );

      update((s) => ({
        ...s,
        routes: nextRoutes,
        stopAudio: nextStopAudio,
      }));

      deleteMediaPaths(removedPaths);
    },
    [update]
  );

  const reorderMiddleStop = useCallback(
    (routeId, stopIndex, direction) => {
      update((s) => ({
        ...s,
        routes: s.routes.map((r) => {
          if (r.id !== routeId) return r;
          const stops = [...(r.stops ?? [])];
          const target = direction === 'up' ? stopIndex - 1 : stopIndex + 1;
          if (stopIndex < 0 || stopIndex >= stops.length || target < 0 || target >= stops.length) {
            return r;
          }
          [stops[stopIndex], stops[target]] = [stops[target], stops[stopIndex]];
          return { ...r, stops };
        }),
      }));
    },
    [update]
  );

  const selectRoute = useCallback(
    (id) => {
      update((s) => applySelectRoute(s, id));
    },
    [update]
  );

  const setRouteDirection = useCallback(
    (routeDirection) => {
      update((s) => applySetRouteDirection(s, routeDirection));
    },
    [update]
  );

  const startTrip = useCallback(() => {
    update((s) => applyStartTrip(s));
  }, [update]);

  const endTrip = useCallback(() => {
    update((s) => applyEndTrip(s));
  }, [update]);

  const moveForward = useCallback(() => {
    let stateAfter = null;
    update((s) => {
      const next = applyMoveForward(s);
      if (next.announcementRequest) stateAfter = next;
      return next;
    });
    if (stateAfter?.announcementRequest) {
      playAnnouncementNow(stateAfter);
    }
  }, [update, playAnnouncementNow]);

  const undoForward = useCallback(() => {
    update((s) => applyUndoForward(s));
  }, [update]);

  const addAd = useCallback(
    (ad) => {
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        ads: [...s.ads, { id: createId(), name: `Ad ${s.ads.length + 1}`, ...ad }],
      }));
    },
    [update]
  );

  const addAds = useCallback(
    (items) => {
      if (!items.length) return;
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        ads: [
          ...s.ads,
          ...items.map((ad, i) => ({
            id: createId(),
            name: `Ad ${s.ads.length + i + 1}`,
            ...ad,
          })),
        ],
      }));
    },
    [update]
  );

  const removeAd = useCallback(
    (id) => {
      const prev = stateRef.current;
      const ad = prev.ads.find((a) => a.id === id);
      if (!ad) return;

      const remainingAds = prev.ads.filter((a) => a.id !== id);
      const stillUsed = collectUsedAdMediaPaths(remainingAds, prev.bannerAds);

      update((s) => {
        const removedIndex = s.ads.findIndex((a) => a.id === id);
        const ads = remainingAds;
        const clamp = (index) => (ads.length ? Math.min(index, ads.length - 1) : 0);
        let nextAdIndex = clamp(s.nextAdIndex ?? 0);
        let currentAdIndex = clamp(s.currentAdIndex ?? 0);

        if (!ads.length) {
          nextAdIndex = 0;
          currentAdIndex = 0;
        } else if (removedIndex >= 0) {
          if (removedIndex < nextAdIndex) nextAdIndex -= 1;
          if (removedIndex < currentAdIndex) currentAdIndex -= 1;
          nextAdIndex = clamp(nextAdIndex);
          currentAdIndex = clamp(currentAdIndex);
        }

        const noAdsLeft = !ads.length;
        const stoppedCurrentAd =
          s.displayView === 'ad' && removedIndex >= 0 && removedIndex === s.currentAdIndex;

        return {
          ...s,
          adsSavedAt: Date.now(),
          ads,
          nextAdIndex,
          currentAdIndex,
          ...(noAdsLeft || stoppedCurrentAd
            ? { displayView: 'route', lastAdEndedAt: Date.now() }
            : {}),
        };
      });

      void deleteUnusedAdMedia(ad, stillUsed).catch((err) => {
        console.warn('AdKerala: could not delete ad media from db', err);
      });
    },
    [update]
  );

  const updateAd = useCallback(
    (id, data) => {
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        ads: s.ads.map((a) => (a.id === id ? { ...a, ...data } : a)),
      }));
    },
    [update]
  );

  const addBannerAd = useCallback(
    (ad) => {
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        bannerAds: [...s.bannerAds, { id: createId(), name: `Banner ${s.bannerAds.length + 1}`, ...ad }],
      }));
    },
    [update]
  );

  const addBannerAds = useCallback(
    (items) => {
      if (!items.length) return;
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        bannerAds: [
          ...s.bannerAds,
          ...items.map((ad, i) => ({
            id: createId(),
            name: `Banner ${s.bannerAds.length + i + 1}`,
            ...ad,
          })),
        ],
      }));
    },
    [update]
  );

  const removeBannerAd = useCallback(
    (id) => {
      const prev = stateRef.current;
      const ad = prev.bannerAds.find((a) => a.id === id);
      if (!ad) return;

      const remainingBanners = prev.bannerAds.filter((a) => a.id !== id);
      const stillUsed = collectUsedAdMediaPaths(prev.ads, remainingBanners);

      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        bannerAds: remainingBanners,
      }));

      void deleteUnusedAdMedia(ad, stillUsed).catch((err) => {
        console.warn('AdKerala: could not delete banner media from db', err);
      });
    },
    [update]
  );

  const updateBannerAd = useCallback(
    (id, data) => {
      update((s) => ({
        ...s,
        adsSavedAt: Date.now(),
        bannerAds: s.bannerAds.map((a) => (a.id === id ? { ...a, ...data } : a)),
      }));
    },
    [update]
  );

  const updateBannerAdSettings = useCallback(
    (settings) => {
      update((s) => ({ ...s, bannerAdSettings: { ...s.bannerAdSettings, ...settings } }));
    },
    [update]
  );

  const playAdNow = useCallback(() => {
    update((s) => {
      const index = nextPlayableAdIndex(s.ads, s.nextAdIndex ?? 0);
      if (index < 0) {
        return s.displayView === 'ad'
          ? { ...s, displayView: 'route', lastAdEndedAt: Date.now(), adStartedAt: null }
          : s;
      }
      if (s.displayView === 'ad') return s;
      return {
        ...s,
        displayView: 'ad',
        currentAdIndex: index,
        adStartedAt: Date.now(),
      };
    });
  }, [update]);

  const endAd = useCallback(() => {
    setState((prev) => {
      const next = !prev.ads.length
        ? { ...prev, displayView: 'route', lastAdEndedAt: Date.now(), adStartedAt: null }
        : {
            ...prev,
            displayView: 'route',
            lastAdEndedAt: Date.now(),
            nextAdIndex: ((prev.currentAdIndex ?? 0) + 1) % prev.ads.length,
            adStartedAt: null,
          };
      const stamped = { ...next, savedAt: Date.now() };
      lastWriteAtRef.current = stamped.savedAt;
      const result = saveState(stamped);
      if (!result.ok) {
        setTimeout(() => setStorageError(result.error), 0);
      } else {
        setTimeout(() => setStorageError(null), 0);
      }
      return stamped;
    });
  }, []);

  const toggleDisplayMode = useCallback(() => {
    update((s) => {
      if (s.appView === 'display' || s.isFullscreen) {
        return {
          ...s,
          appView: 'control',
          isFullscreen: false,
          displayView: 'route',
          lastAdEndedAt: s.displayView === 'ad' ? Date.now() : s.lastAdEndedAt,
        };
      }
      return {
        ...s,
        appView: 'display',
        isFullscreen: true,
        displayView: 'route',
        displayOpenedAt: Date.now(),
      };
    });
  }, [update]);

  const enterDisplayMode = useCallback(() => {
    update((s) => ({
      ...s,
      appView: 'display',
      isFullscreen: true,
      displayView: 'route',
      displayOpenedAt: Date.now(),
    }));
  }, [update]);

  const markDisplayOpened = useCallback(() => {
    update((s) => ({ ...s, displayOpenedAt: Date.now() }));
  }, [update]);

  const exitToControl = useCallback(() => {
    update((s) => ({
      ...s,
      appView: 'control',
      isFullscreen: false,
      displayView: 'route',
      lastAdEndedAt: s.displayView === 'ad' ? Date.now() : s.lastAdEndedAt,
    }));
  }, [update]);

  const updateSerialSettings = useCallback(
    (settings) => {
      update((s) => ({
        ...s,
        serialSettings: {
          ...s.serialSettings,
          ...settings,
          buttonMappings: settings.buttonMappings
            ? { ...s.serialSettings?.buttonMappings, ...settings.buttonMappings }
            : s.serialSettings?.buttonMappings,
        },
      }));
    },
    [update]
  );

  const updateSerialRuntime = useCallback((runtime) => {
    setState((prev) => {
      const prevRt = prev.serialRuntime ?? {};
      const next = { ...prevRt, ...runtime, at: runtime?.at ?? Date.now() };
      if (
        prevRt.status === next.status &&
        prevRt.portLabel === next.portLabel &&
        prevRt.error === next.error &&
        prevRt.isConnected === next.isConnected &&
        prevRt.lastLine === next.lastLine
      ) {
        return prev;
      }
      const updated = { ...prev, serialRuntime: next };
      stateRef.current = updated;
      return updated;
    });
  }, []);

  const updateAdSettings = useCallback(
    (settings) => {
      update((s) => ({ ...s, adSettings: { ...s.adSettings, ...settings } }));
    },
    [update]
  );

  const updateDisplaySettings = useCallback(
    (settings) => {
      update((s) => ({ ...s, displaySettings: { ...s.displaySettings, ...settings } }));
    },
    [update]
  );

  const updateAnnouncementSettings = useCallback(
    (settings) => {
      update((s) => ({
        ...s,
        announcementSettings: { ...s.announcementSettings, ...settings },
      }));
    },
    [update]
  );

  const updateDriveSettings = useCallback(
    (settings) => {
      update((s) => ({
        ...s,
        driveSettings: { ...s.driveSettings, ...settings },
      }));
    },
    [update]
  );

  const updateAudioFragment = useCallback(
    (phraseKey, lang, audioUrl) => {
      (async () => {
        let url = audioUrl;
        if (audioUrl?.startsWith('data:')) {
          try {
            const uploaded = await uploadDataUrl(
              'announcements',
              audioUrl,
              `${phraseKey}_${lang}.webm`
            );
            url = uploaded.url;
          } catch (err) {
            setTimeout(() => setStorageError(err?.message ?? 'Could not save audio file.'), 0);
            return;
          }
        }
        update((s) => ({
          ...s,
          audioFragments: {
            ...s.audioFragments,
            [phraseKey]: {
              ...s.audioFragments?.[phraseKey],
              [lang]: { audioUrl: url },
            },
          },
        }));
      })();
    },
    [update]
  );

  const clearAudioFragment = useCallback(
    (phraseKey, lang) => {
      update((s) => {
        const phrase = { ...s.audioFragments?.[phraseKey] };
        delete phrase[lang];
        const audioFragments = { ...s.audioFragments };
        if (Object.keys(phrase).length) {
          audioFragments[phraseKey] = phrase;
        } else {
          delete audioFragments[phraseKey];
        }
        return { ...s, audioFragments };
      });
    },
    [update]
  );

  const updateStopAudioClip = useCallback(
    (stopKey, lang, audioUrl) => {
      (async () => {
        const oldPath = mediaUrlToPath(stateRef.current.stopAudio?.[stopKey]?.[lang]?.audioUrl);
        let url = audioUrl;
        if (audioUrl?.startsWith('data:')) {
          try {
            const safeKey = stopKey.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40);
            const uploaded = await uploadDataUrl('stops', audioUrl, `${safeKey}_${lang}.webm`);
            url = uploaded.url;
          } catch (err) {
            setTimeout(() => setStorageError(err?.message ?? 'Could not save audio file.'), 0);
            return;
          }
        }
        update((s) => ({
          ...s,
          stopAudio: {
            ...s.stopAudio,
            [stopKey]: {
              ...s.stopAudio?.[stopKey],
              [lang]: { audioUrl: url },
            },
          },
        }));

        const newPath = mediaUrlToPath(url);
        if (oldPath && oldPath !== newPath) {
          deleteMediaPaths([oldPath]);
        }
      })();
    },
    [update]
  );

  const clearStopAudioClip = useCallback(
    (stopKey, lang) => {
      const oldPath = mediaUrlToPath(stateRef.current.stopAudio?.[stopKey]?.[lang]?.audioUrl);

      update((s) => {
        const entry = { ...s.stopAudio?.[stopKey] };
        delete entry[lang];
        const stopAudio = { ...s.stopAudio };
        if (Object.keys(entry).length) {
          stopAudio[stopKey] = entry;
        } else {
          delete stopAudio[stopKey];
        }
        return { ...s, stopAudio };
      });

      if (oldPath) deleteMediaPaths([oldPath]);
    },
    [update]
  );

  const requestAnnouncement = useCallback(
    (stop, { isTerminus = false } = {}) => {
      if (!stop) return;
      let stateAfter = null;
      update((s) => {
        stateAfter = applyRequestAnnouncement(s, {
          stopEn: normalizeStop(stop).en,
          isTerminus,
        });
        return stateAfter;
      });
      if (stateAfter) playAnnouncementNow(stateAfter);
    },
    [update, playAnnouncementNow]
  );

  return {
    state,
    storageError,
    clearStorageError,
    applyRemoteState,
    commitServerState,
    updateDriverLocation,
    update,
    addRoute,
    importRoute,
    updateRoute,
    deleteRoute,
    addStop,
    updateStopMalayalam,
    removeStop,
    reorderMiddleStop,
    mergeStopCatalog,
    upsertStopInCatalog,
    updateStopLocation,
    selectRoute,
    setRouteDirection,
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    addAd,
    addAds,
    removeAd,
    updateAd,
    addBannerAd,
    addBannerAds,
    removeBannerAd,
    updateBannerAd,
    updateBannerAdSettings,
    playAdNow,
    endAd,
    toggleDisplayMode,
    enterDisplayMode,
    markDisplayOpened,
    exitToControl,
    updateSerialSettings,
    updateSerialRuntime,
    updateAdSettings,
    updateDisplaySettings,
    updateAnnouncementSettings,
    updateDriveSettings,
    updateAudioFragment,
    clearAudioFragment,
    updateStopAudioClip,
    clearStopAudioClip,
    requestAnnouncement,
    clearAnnouncementRequest,
    setAnnouncementStatus,
  };
}

export function BusStoreProvider({ children }) {
  const store = useBusStoreLogic();
  return <BusStoreContext.Provider value={store}>{children}</BusStoreContext.Provider>;
}
