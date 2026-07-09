import { getActiveRoute, getAllStops, findStopByEn } from '../store/busStore';
import { buildAnnouncementSequence, resolveClipUrl, stopAudioKey } from './audioFragments';
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
export function runAnnouncementPlayback(state, { onStart, onEnd, onEmpty, onAudioAdPlayed } = {}) {
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

  // Ad-play tracking for the stop-voice-ad tail of this sequence (see audioFragments.js —
  // it's always the last fragment, if present). Resolved independently here rather than
  // threading a "which fragment is the ad" flag through buildAnnouncementSequence, which stays
  // a generic URL/pause list for every other caller.
  const voiceAdKey = stopAudioKey(stop);
  const voiceAdEntry = state.stopVoiceAds?.[voiceAdKey];
  const adUrl = voiceAdEntry?.enabled ? resolveClipUrl(voiceAdEntry) : null;
  let adPlayStartedAt = null;

  playAnnouncementSequence(sequence, {
    onStart: () => {
      onStart?.();
      pauseAdMedia();
    },
    onFragment: (url) => {
      if (adUrl && url === adUrl) adPlayStartedAt = Date.now();
    },
    onEnd: () => {
      // Reaching onEnd (rather than being silently superseded/cancelled — see
      // announcementPlayer.js's activeController bookkeeping) means the ad fragment, being
      // last in the sequence, played through to its own 'ended'/'error' resolution.
      if (voiceAdEntry?.id && adPlayStartedAt) {
        const durationPlayedSec = Math.max(0, Math.round((Date.now() - adPlayStartedAt) / 1000));
        onAudioAdPlayed?.(voiceAdEntry, adPlayStartedAt, durationPlayedSec, true);
      }
      onEnd?.();
    },
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
