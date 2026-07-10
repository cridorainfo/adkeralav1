import { useEffect, useState } from 'react';
import { getNativeTrackingStatus, isAndroidNative } from '../lib/nativeGpsTracker.js';

const POLL_MS = 3000;

/** Polls the native Android tracker's own state — the source of truth for whether
 *  GPS is actually flowing when the always-on foreground service owns tracking. */
export function useNativeGpsStatus(enabled) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!enabled || !isAndroidNative()) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;

    const poll = async () => {
      const result = await getNativeTrackingStatus();
      if (!cancelled) setStatus(result);
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);

  return status;
}
