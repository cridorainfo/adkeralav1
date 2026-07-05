import { useEffect, useRef } from 'react';
import { useBusStore } from './useBusStore';
import { fetchStateFromDb, isDbApiAvailable } from '../lib/fileStorage';
import { isPersistenceReady } from '../store/busStore';

const POLL_MS = 2000;
const POLL_MS_LIVE = 5000;

function snapshotFingerprint(remote) {
  return {
    savedAt: remote?.savedAt ?? 0,
    lastCloudPushAt: remote?.lastCloudPushAt ?? 0,
    driveRevision: remote?.driveRevision ?? 0,
    driverLinkId: remote?.driverLink?.driverId ?? null,
    connectedDeviceCount: remote?.connectedDeviceCount ?? 0,
    tripStarted: Boolean(remote?.tripStarted),
    tripEnded: Boolean(remote?.tripEnded),
    tripDeparted: Boolean(remote?.tripDeparted),
    currentStopIndex: remote?.currentStopIndex ?? 0,
    activeRouteId: remote?.activeRouteId ?? null,
    routeDirection: remote?.routeDirection ?? 'forward',
    routesCount: (remote?.routes ?? []).length,
    assignedRouteCount: (remote?.busProfile?.assignedRouteIds ?? []).length,
  };
}

function fingerprintsEqual(a, b) {
  return (
    a.savedAt === b.savedAt &&
    a.lastCloudPushAt === b.lastCloudPushAt &&
    a.driveRevision === b.driveRevision &&
    a.driverLinkId === b.driverLinkId &&
    a.connectedDeviceCount === b.connectedDeviceCount &&
    a.tripStarted === b.tripStarted &&
    a.tripEnded === b.tripEnded &&
    a.tripDeparted === b.tripDeparted &&
    a.currentStopIndex === b.currentStopIndex &&
    a.activeRouteId === b.activeRouteId &&
    a.routeDirection === b.routeDirection &&
    a.routesCount === b.routesCount &&
    a.assignedRouteCount === b.assignedRouteCount
  );
}

/** Keep display/control in sync with db/info.txt — instant via SSE, fallback poll. */
export function useRemoteStateSync(enabled = true) {
  const { applyRemoteState } = useBusStore();
  const lastSeenRef = useRef(null);
  const initialForceRef = useRef(true);

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

        const fingerprint = snapshotFingerprint(remote);
        const forceInitial = initialForceRef.current;
        if (forceInitial) initialForceRef.current = false;

        if (!force && !forceInitial && lastSeenRef.current && fingerprintsEqual(fingerprint, lastSeenRef.current)) {
          return;
        }

        lastSeenRef.current = fingerprint;
        applyRemoteState(remote, { force: force || forceInitial });
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
export async function refreshRemoteState(applyRemoteState, { force = true } = {}) {
  if (!isPersistenceReady() || !(await isDbApiAvailable())) return null;
  const remote = await fetchStateFromDb();
  applyRemoteState(remote, { force });
  return remote;
}
