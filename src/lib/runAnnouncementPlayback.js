import { getActiveRoute, getAllStops, findStopByEn } from '../store/busStore';
import { buildAnnouncementSequence } from './audioFragments';
import { playAnnouncementSequence } from './announcementPlayer';

let lastAnnouncementId = null;

function pauseAdMedia() {
  document.querySelectorAll('audio, video').forEach((el) => {
    try {
      el.pause();
      el.muted = true;
    } catch {
      /* ignore */
    }
  });
}

/**
 * Play announcement audio for the current announcementRequest.
 * Call synchronously from click handlers so Chrome keeps the user-gesture
 * context (useEffect playback is blocked in fullscreen Chrome from run.bat).
 */
export function runAnnouncementPlayback(state, { onStart, onEnd, onEmpty } = {}) {
  const req = state.announcementRequest;
  if (!req?.id || req.id === lastAnnouncementId) return false;
  if (!(state.announcementSettings?.enabled ?? true)) return false;

  const route = getActiveRoute(state);
  const stops = getAllStops(route);
  const stop = findStopByEn(stops, req.stopEn);
  const sequence = buildAnnouncementSequence(state, stop, { isTerminus: req.isTerminus });

  if (!sequence.length) {
    onEmpty?.();
    return false;
  }

  lastAnnouncementId = req.id;

  playAnnouncementSequence(sequence, {
    onStart: () => {
      onStart?.();
      pauseAdMedia();
    },
    onEnd: () => onEnd?.(),
  }).catch(() => onEnd?.());

  return true;
}

export function clearAnnouncementPlaybackId(id) {
  if (!id || lastAnnouncementId === id) {
    lastAnnouncementId = null;
  }
}

export function getLastAnnouncementPlaybackId() {
  return lastAnnouncementId;
}
