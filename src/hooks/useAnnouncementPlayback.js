import { useEffect, useRef } from 'react';
import { useBusStore } from './useBusStore';
import {
  runAnnouncementPlayback,
  clearAnnouncementPlaybackId,
  getLastAnnouncementPlaybackId,
} from '../lib/runAnnouncementPlayback';
import { cancelAnnouncement } from '../lib/announcementPlayer';

/**
 * Fallback playback when announcementRequest is set without a synchronous
 * trigger (e.g. serial speech button, cross-tab sync).
 */
export function useAnnouncementPlayback() {
  const { state, clearAnnouncementRequest, setAnnouncementStatus } = useBusStore();
  const reqIdRef = useRef(null);

  useEffect(() => {
    const req = state.announcementRequest;
    if (!req?.id) return;
    if (req.id === getLastAnnouncementPlaybackId()) return;

    reqIdRef.current = req.id;
    let cancelled = false;

    runAnnouncementPlayback(state, {
      onStart: () => setAnnouncementStatus('playing'),
      onEnd: () => {
        setAnnouncementStatus(null);
        if (!cancelled) clearAnnouncementRequest();
      },
      onEmpty: () => {
        if (!cancelled) clearAnnouncementRequest();
      },
    });

    return () => {
      cancelled = true;
      cancelAnnouncement();
      setAnnouncementStatus(null);
      clearAnnouncementPlaybackId(reqIdRef.current);
      reqIdRef.current = null;
    };
  }, [
    state.announcementRequest,
    state.announcementSettings?.enabled,
    state.audioFragments,
    state.stopAudio,
    state.announcementSettings?.languages,
    clearAnnouncementRequest,
    setAnnouncementStatus,
  ]);
}
