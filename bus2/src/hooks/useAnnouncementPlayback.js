import { useEffect, useRef } from 'react';
import { useBusStore } from './useBusStore';
import {
  runAnnouncementPlayback,
  getLastAnnouncementPlaybackId,
} from '../lib/runAnnouncementPlayback';
import { cancelAnnouncement } from '../lib/announcementPlayer';
import { isDisplayRole } from '../lib/appRole';

/**
 * Playback on bus PC (/display) when announcementRequest arrives via sync or serial.
 * Control phone only queues the request — audio plays on the passenger display.
 */
export function useAnnouncementPlayback() {
  const { state, clearAnnouncementRequest, setAnnouncementStatus } = useBusStore();
  const stateRef = useRef(state);
  stateRef.current = state;

  const requestId = state.announcementRequest?.id ?? null;

  useEffect(() => {
    if (!isDisplayRole()) return undefined;
    if (!requestId) return undefined;

    const req = stateRef.current.announcementRequest;
    if (!req?.id || req.id !== requestId) return undefined;
    if (req.id === getLastAnnouncementPlaybackId()) return undefined;

    let cancelled = false;

    runAnnouncementPlayback(stateRef.current, {
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
    };
  }, [requestId, clearAnnouncementRequest, setAnnouncementStatus]);
}
