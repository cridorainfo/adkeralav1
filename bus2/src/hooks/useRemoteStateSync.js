import { useEffect, useRef } from 'react';
import { useBusStore } from './useBusStore';
import { fetchStateFromDb, isDbApiAvailable } from '../lib/fileStorage';
import { isPersistenceReady } from '../store/busStore';

const POLL_MS = 2000;
const POLL_MS_LIVE = 5000;

/** Keep display/control in sync with db/info.txt — instant via SSE, fallback poll. */
export function useRemoteStateSync(enabled = true) {
  const { applyRemoteState } = useBusStore();
  const lastSeenRef = useRef({
    savedAt: 0,
    lastCloudPushAt: 0,
    driveRevision: 0,
    driverLinkId: null,
    connectedDeviceCount: -1,
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    let pollTimer = null;

    const poll = async (force = false) => {
      try {
        if (!isPersistenceReady()) return;
        if (!(await isDbApiAvailable())) return;
        const remote = await fetchStateFromDb();
        if (cancelled) return;

        const savedAt = remote?.savedAt ?? 0;
        const cloudPush = remote?.lastCloudPushAt ?? 0;
        const driveRevision = remote?.driveRevision ?? 0;
        const driverLinkId = remote?.driverLink?.driverId ?? null;
        const connectedDeviceCount = remote?.connectedDeviceCount ?? 0;
        const last = lastSeenRef.current;
        if (
          !force &&
          savedAt === last.savedAt &&
          cloudPush === last.lastCloudPushAt &&
          driveRevision === last.driveRevision &&
          driverLinkId === last.driverLinkId &&
          connectedDeviceCount === last.connectedDeviceCount
        ) {
          return;
        }

        lastSeenRef.current = {
          savedAt,
          lastCloudPushAt: cloudPush,
          driveRevision,
          driverLinkId,
          connectedDeviceCount,
        };
        applyRemoteState(remote);
      } catch {
        /* server not ready */
      }
    };

    const schedulePoll = (delayMs) => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => poll(false), delayMs);
    };

    poll(true);
    schedulePoll(POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') poll(true);
    };
    document.addEventListener('visibilitychange', onVisible);

    let eventSource = null;
    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource('/api/state/events');

      eventSource.onopen = () => {
        schedulePoll(POLL_MS_LIVE);
      };

      eventSource.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state-changed') {
            poll(true);
          }
        } catch {
          /* ignore */
        }
      };

      eventSource.onerror = () => {
        schedulePoll(POLL_MS);
      };
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      eventSource?.close();
    };
  }, [enabled, applyRemoteState]);
}

/** Pull latest db/info.txt into React state (after /api/drive, etc.). */
export async function refreshRemoteState(applyRemoteState) {
  if (!isPersistenceReady() || !(await isDbApiAvailable())) return null;
  const remote = await fetchStateFromDb();
  applyRemoteState(remote);
  return remote;
}
