const HIDDEN_POLL_MS = 4000;
const GEO_WATCH = { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 };
const GEO_POLL = { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 };

function coordsFromPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords ?? pos;
  return {
    lat,
    lng,
    accuracy: accuracy ?? null,
    heading: heading ?? null,
    speed: speed ?? null,
    at: pos.timestamp ?? Date.now(),
  };
}

/** Keep GPS alive when screen dims, tab is hidden, or user switches apps. */
export function createPersistentGpsWatcher({ onFix, onError, onPermission }) {
  let watchId = null;
  let hiddenPollId = null;
  let wakeLock = null;
  let capacitorClear = null;
  let capPollOnce = null;
  let active = false;
  let mode = 'web';

  const emitGranted = () => onPermission?.('granted');
  const emitDenied = (err) => onPermission?.(err?.code === 1 ? 'denied' : 'error');

  const handleFix = (pos) => {
    emitGranted();
    onFix(coordsFromPosition(pos));
  };

  const handleErr = (err) => {
    emitDenied(err);
    onError?.({
      lat: null,
      lng: null,
      accuracy: null,
      error: err?.message || 'GPS unavailable',
      at: Date.now(),
    });
  };

  const pollOnceWeb = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(handleFix, handleErr, GEO_POLL);
  };

  const clearWebWatch = () => {
    if (watchId != null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  const startWebWatch = () => {
    if (!navigator.geolocation) return;
    clearWebWatch();
    watchId = navigator.geolocation.watchPosition(handleFix, handleErr, GEO_WATCH);
  };

  const stopHiddenPoll = () => {
    if (hiddenPollId != null) {
      clearInterval(hiddenPollId);
      hiddenPollId = null;
    }
  };

  const startHiddenPoll = (pollFn) => {
    if (hiddenPollId != null) return;
    pollFn();
    hiddenPollId = setInterval(pollFn, HIDDEN_POLL_MS);
  };

  const releaseWakeLock = async () => {
    try {
      await wakeLock?.release?.();
    } catch {
      /* ignore */
    }
    wakeLock = null;
  };

  const acquireWakeLock = async () => {
    if (!('wakeLock' in navigator)) return;
    try {
      await releaseWakeLock();
      if (document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock?.addEventListener?.('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      /* denied or unsupported */
    }
  };

  const onVisibilityChange = () => {
    if (!active) return;
    const pollFn = mode === 'native' && capPollOnce ? capPollOnce : pollOnceWeb;
    if (document.visibilityState === 'visible') {
      stopHiddenPoll();
      acquireWakeLock();
      if (mode === 'web') {
        startWebWatch();
      }
      pollFn();
    } else {
      startHiddenPoll(pollFn);
    }
  };

  const attachLifecycle = () => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    window.addEventListener('pageshow', onVisibilityChange);
  };

  const detachLifecycle = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onVisibilityChange);
    window.removeEventListener('pageshow', onVisibilityChange);
  };

  const startWeb = () => {
    mode = 'web';
    if (!navigator.geolocation) return;
    pollOnceWeb();
    startWebWatch();
    acquireWakeLock();
    attachLifecycle();
    if (document.visibilityState === 'hidden') startHiddenPoll(pollOnceWeb);
  };

  const stopWeb = () => {
    detachLifecycle();
    clearWebWatch();
    stopHiddenPoll();
    releaseWakeLock();
  };

  const startCapacitor = async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return false;

      const { Geolocation } = await import('@capacitor/geolocation');
      const perm = await Geolocation.requestPermissions();
      if (perm.location === 'denied') {
        onPermission?.('denied');
        return true;
      }

      mode = 'native';
      capPollOnce = async () => {
        try {
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: 25000,
            maximumAge: 5000,
          });
          handleFix(pos);
        } catch (err) {
          handleErr(err);
        }
      };

      await capPollOnce();

      const watch = await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 },
        (pos, err) => {
          if (err) {
            handleErr(err);
            return;
          }
          if (pos) handleFix(pos);
        }
      );

      capacitorClear = async () => {
        try {
          await Geolocation.clearWatch({ id: watch });
        } catch {
          /* ignore */
        }
      };

      if (Capacitor.getPlatform() === 'android') {
        try {
          const { startAndroidTrackingService, stopAndroidTrackingService } = await import(
            './androidTrackingService.js'
          );
          await startAndroidTrackingService();
          const prevClear = capacitorClear;
          capacitorClear = async () => {
            await prevClear?.();
            await stopAndroidTrackingService();
          };
        } catch {
          /* foreground service optional */
        }
      }

      acquireWakeLock();
      attachLifecycle();
      if (document.visibilityState === 'hidden') startHiddenPoll(capPollOnce);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async start() {
      if (active) return;
      active = true;
      const native = await startCapacitor();
      if (!native) startWeb();
    },
    async stop() {
      if (!active) return;
      active = false;
      stopWeb();
      if (capacitorClear) {
        await capacitorClear();
        capacitorClear = null;
      }
      capPollOnce = null;
      mode = 'web';
    },
    requestFix() {
      if (capPollOnce) capPollOnce();
      else pollOnceWeb();
    },
  };
}
