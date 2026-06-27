import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  loadState,
  loadStateAsync,
  saveState,
  subscribe,
  createId,
  getActiveRoute,
  getAllStops,
  getStopInfo,
  getUpcomingPassengerStop,
  getTripStartIndex,
  normalizeRouteMiddleStops,
  dedupeRoutes,
  normalizeStop,
  sameStop,
  mergeRemoteState,
} from '../store/busStore';
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

const BusStoreContext = createContext(null);

function useBusStoreLogic() {
  const [state, setState] = useState(loadState);
  const [storageError, setStorageError] = useState(null);
  const stateRef = useRef(state);
  const lastWriteAtRef = useRef(0);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    loadStateAsync()
      .then((stored) => {
        if (cancelled || typeof stored !== 'object' || stored === null) return;
        setState(stored);
      })
      .catch(() => {
        /* keep sync localStorage state already shown */
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
      saveState(stateRef.current);
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
      const remoteAt = remoteHydrated?.savedAt ?? 0;
      const prevAt = prev?.savedAt ?? 0;
      if (remoteAt <= prevAt) return prev;
      if (Date.now() - lastWriteAtRef.current < 800 && remoteAt <= lastWriteAtRef.current) {
        return prev;
      }
      const merged = mergeRemoteState(prev, remoteHydrated);
      const localGpsAt = prev.driverLocation?.at ?? 0;
      const remoteGpsAt = remoteHydrated.driverLocation?.at ?? 0;
      if (localGpsAt > remoteGpsAt) {
        merged.driverLocation = prev.driverLocation;
      }
      return merged;
    });
  }, []);

  const updateDriverLocation = useCallback((location, persist = false) => {
    setState((prev) => {
      const next = { ...prev, driverLocation: location };
      if (!persist) return next;
      const stamped = { ...next, savedAt: Date.now() };
      lastWriteAtRef.current = stamped.savedAt;
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
      const route = {
        id: createId(),
        name,
        startStop: { en: startEn.trim(), ml: startMl.trim() },
        endStop: { en: endEn.trim(), ml: endMl.trim() },
        stops: [],
      };
      update((s) => ({
        ...s,
        routes: [...s.routes, route],
        activeRouteId: route.id,
        currentStopIndex: 0,
        tripDeparted: false,
        routeDirection: 'forward',
      }));
      return route.id;
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
    (routeId, stopEn, stopMl = '') => {
      const trimmed = stopEn.trim();
      if (!trimmed) return false;

      const newStop = { en: trimmed, ml: stopMl.trim() };

      update((s) => {
        const current = s.routes.find((r) => r.id === routeId);
        if (!current) return s;
        if (getAllStops(current).some((stop) => sameStop(stop, newStop))) return s;

        return {
          ...s,
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
      update((s) => {
        const route = s.routes.find((r) => r.id === id);
        const stops = route ? getAllStops(route) : [];
        const dir = s.routeDirection ?? 'forward';
        return {
          ...s,
          activeRouteId: id,
          currentStopIndex: getTripStartIndex(stops, dir),
          tripDeparted: false,
          displayView: 'route',
        };
      });
    },
    [update]
  );

  const setRouteDirection = useCallback(
    (routeDirection) => {
      update((s) => {
        const route = getActiveRoute(s);
        if (!route) return s;
        const stops = getAllStops(route);
        const tripStart = getTripStartIndex(stops, s.routeDirection ?? 'forward');
        if (s.tripDeparted) return s;

        return {
          ...s,
          routeDirection,
          currentStopIndex: getTripStartIndex(stops, routeDirection),
          tripDeparted: false,
          displayView: 'route',
        };
      });
    },
    [update]
  );

  const moveForward = useCallback(() => {
    let stateAfter = null;
    update((s) => {
      const route = getActiveRoute(s);
      if (!route) return s;
      const stops = getAllStops(route);
      const dir = s.routeDirection ?? 'forward';
      const tripStart = getTripStartIndex(stops, dir);

      if (dir === 'forward') {
        if (s.tripDeparted && s.currentStopIndex >= stops.length - 1) return s;

        const nextDepartedIdx = s.tripDeparted
          ? Math.min(s.currentStopIndex + 1, stops.length - 1)
          : tripStart;

        if (s.tripDeparted && nextDepartedIdx === s.currentStopIndex) return s;

        const afterState = {
          ...s,
          tripDeparted: true,
          currentStopIndex: nextDepartedIdx,
        };
        const announceStop = getUpcomingPassengerStop(afterState);
        if (!announceStop) return s;

        const isTerminus = sameStop(announceStop, stops[stops.length - 1]);
        const shouldAnnounce =
          (s.announcementSettings?.enabled ?? true) &&
          (s.announcementSettings?.autoAnnounceOnForward ?? true);

        stateAfter = {
          ...afterState,
          announcementRequest: shouldAnnounce
            ? {
                id: createId(),
                stopEn: normalizeStop(announceStop).en,
                isTerminus: Boolean(isTerminus),
                at: Date.now(),
              }
            : null,
        };
        return stateAfter;
      }

      if (s.tripDeparted && s.currentStopIndex <= 0) return s;

      const nextDepartedIdx = s.tripDeparted
        ? Math.max(s.currentStopIndex - 1, 0)
        : tripStart;

      if (s.tripDeparted && nextDepartedIdx === s.currentStopIndex) return s;

      const afterState = {
        ...s,
        tripDeparted: true,
        currentStopIndex: nextDepartedIdx,
      };
      const announceStop = getUpcomingPassengerStop(afterState);
      if (!announceStop) return s;

      const isTerminus = sameStop(announceStop, stops[0]);
      const shouldAnnounce =
        (s.announcementSettings?.enabled ?? true) &&
        (s.announcementSettings?.autoAnnounceOnForward ?? true);

      stateAfter = {
        ...afterState,
        announcementRequest: shouldAnnounce
          ? {
              id: createId(),
              stopEn: normalizeStop(announceStop).en,
              isTerminus: Boolean(isTerminus),
              at: Date.now(),
            }
          : null,
      };
      return stateAfter;
    });
    if (stateAfter?.announcementRequest) {
      playAnnouncementNow(stateAfter);
    }
  }, [update, playAnnouncementNow]);

  const undoForward = useCallback(() => {
    update((s) => {
      const route = getActiveRoute(s);
      if (!route) return s;
      const stops = getAllStops(route);
      const dir = s.routeDirection ?? 'forward';
      const tripStart = getTripStartIndex(stops, dir);

      if (!s.tripDeparted) return s;

      if (dir === 'forward') {
        if (s.currentStopIndex <= tripStart) {
          return {
            ...s,
            tripDeparted: false,
            currentStopIndex: tripStart,
            displayView: 'route',
            announcementRequest: null,
          };
        }
        return {
          ...s,
          currentStopIndex: s.currentStopIndex - 1,
          displayView: 'route',
          announcementRequest: null,
        };
      }

      if (s.currentStopIndex >= tripStart) {
        return {
          ...s,
          tripDeparted: false,
          currentStopIndex: tripStart,
          displayView: 'route',
          announcementRequest: null,
        };
      }
      return {
        ...s,
        currentStopIndex: s.currentStopIndex + 1,
        displayView: 'route',
        announcementRequest: null,
      };
    });
  }, [update]);

  const addAd = useCallback(
    (ad) => {
      update((s) => ({
        ...s,
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
      const remainingAds = prev.ads.filter((a) => a.id !== id);
      const stillUsed = collectUsedAdMediaPaths(remainingAds, prev.bannerAds);

      update((s) => {
        const removedIndex = s.ads.findIndex((a) => a.id === id);
        const ads = s.ads.filter((a) => a.id !== id);
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

        return { ...s, ads, nextAdIndex, currentAdIndex };
      });

      if (ad) deleteUnusedAdMedia(ad, stillUsed);
    },
    [update]
  );

  const updateAd = useCallback(
    (id, data) => {
      update((s) => ({
        ...s,
        ads: s.ads.map((a) => (a.id === id ? { ...a, ...data } : a)),
      }));
    },
    [update]
  );

  const addBannerAd = useCallback(
    (ad) => {
      update((s) => ({
        ...s,
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
      const remainingBanners = prev.bannerAds.filter((a) => a.id !== id);
      const stillUsed = collectUsedAdMediaPaths(prev.ads, remainingBanners);

      update((s) => ({
        ...s,
        bannerAds: s.bannerAds.filter((a) => a.id !== id),
      }));

      if (ad) deleteUnusedAdMedia(ad, stillUsed);
    },
    [update]
  );

  const updateBannerAd = useCallback(
    (id, data) => {
      update((s) => ({
        ...s,
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
      if (!s.ads.length || s.displayView === 'ad') return s;
      const index = (s.nextAdIndex ?? 0) % s.ads.length;
      return { ...s, displayView: 'ad', currentAdIndex: index };
    });
  }, [update]);

  const endAd = useCallback(() => {
    update((s) => {
      if (!s.ads.length) {
        return { ...s, displayView: 'route', lastAdEndedAt: Date.now() };
      }
      const nextAdIndex = (s.currentAdIndex + 1) % s.ads.length;
      return {
        ...s,
        displayView: 'route',
        lastAdEndedAt: Date.now(),
        nextAdIndex,
      };
    });
  }, [update]);

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
      return { ...s, appView: 'display', isFullscreen: true, displayView: 'route' };
    });
  }, [update]);

  const enterDisplayMode = useCallback(() => {
    update((s) => ({
      ...s,
      appView: 'display',
      isFullscreen: true,
      displayView: 'route',
    }));
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
        stateAfter = {
          ...s,
          announcementRequest: {
            id: createId(),
            stopEn: normalizeStop(stop).en,
            isTerminus,
            at: Date.now(),
          },
        };
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
    updateDriverLocation,
    update,
    addRoute,
    updateRoute,
    deleteRoute,
    addStop,
    updateStopMalayalam,
    removeStop,
    reorderMiddleStop,
    selectRoute,
    setRouteDirection,
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
    exitToControl,
    updateSerialSettings,
    updateAdSettings,
    updateDisplaySettings,
    updateAnnouncementSettings,
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

export function useBusStore() {
  const ctx = useContext(BusStoreContext);
  if (!ctx) {
    throw new Error('useBusStore must be used within BusStoreProvider');
  }
  return ctx;
}
