import { useEffect } from 'react';
import { useBusStore } from './useBusStore';
import { fetchStateFromDb, isDbApiAvailable } from '../lib/fileStorage';
import { isPersistenceReady } from '../store/busStore';

const POLL_MS = 1500;

/** Keep control phone and bus display in sync via shared db/info.txt. */
export function useRemoteStateSync(enabled = true) {
  const { applyRemoteState } = useBusStore();

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;

    const poll = async () => {
      try {
        if (!isPersistenceReady()) return;
        if (!(await isDbApiAvailable())) return;
        const remote = await fetchStateFromDb();
        if (!cancelled) applyRemoteState(remote);
      } catch {
        /* server not ready */
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, applyRemoteState]);
}
