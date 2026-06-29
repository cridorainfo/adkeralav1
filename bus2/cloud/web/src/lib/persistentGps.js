import { HIGH_ACCURACY_GEO, requestLocationAccess } from './locationPermissions.js';

const HIDDEN_POLL_MS = 4000;
const GEO_WATCH = HIGH_ACCURACY_GEO;
const GEO_POLL = HIGH_ACCURACY_GEO;

function coordsFromPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy, heading, speed } = pos.coords ?? pos;
  return {
    lat,
    lng,
    accuracy: accuracy ?? null,
    heading: heading ?? null,
    speed: speed ?? null,
    at: Date.now(),
  };
}

/** Keep GPS alive when screen dims, tab is hidden, or user switches apps (best-effort on web/PWA). */
export function createPersistentGpsWatcher({ onFix, onError, onPermission }) {
  let watchId = null;
  let hiddenPollId = null;
  let wakeLock = null;
  let active = false;

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

  const pollOnce = () => {
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

  const startHiddenPoll = () => {
    if (hiddenPollId != null) return;
    pollOnce();
    hiddenPollId = setInterval(pollOnce, HIDDEN_POLL_MS);
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
    if (document.visibilityState === 'visible') {
      stopHiddenPoll();
      acquireWakeLock();
      startWebWatch();
      pollOnce();
    } else {
      startHiddenPoll();
    }
  };

  const startWeb = () => {
    if (!navigator.geolocation) return;
    pollOnce();
    startWebWatch();
    acquireWakeLock();
    if (document.visibilityState === 'hidden') startHiddenPoll();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    window.addEventListener('pageshow', onVisibilityChange);
  };

  const stopWeb = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onVisibilityChange);
    window.removeEventListener('pageshow', onVisibilityChange);
    clearWebWatch();
    stopHiddenPoll();
    releaseWakeLock();
  };

  return {
    async start() {
      if (active) return;
      active = true;
      const perm = await requestLocationAccess();
      if (perm === 'denied') onPermission?.('denied');
      else if (perm === 'granted') onPermission?.('granted');
      else onPermission?.('prompt');
      startWeb();
    },
    stop() {
      if (!active) return;
      active = false;
      stopWeb();
    },
    requestFix() {
      pollOnce();
    },
  };
}
