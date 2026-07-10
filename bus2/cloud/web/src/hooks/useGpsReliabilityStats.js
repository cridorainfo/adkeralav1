import { useMemo, useRef, useState } from 'react';

// A fix gap wider than this means tracking effectively stalled (app backgrounded,
// screen locked, GPS lost) rather than just normal 2-4s reporting cadence.
const GAP_THRESHOLD_MS = 10000;

/**
 * Measures real tracking dropouts from the fix stream itself (gaps between
 * consecutive fixes), not just visibility state — so it also catches OS-level
 * throttling that happens without a visibilitychange event.
 */
export function useGpsReliabilityStats(location) {
  const lastAtRef = useRef(null);
  const startRef = useRef(Date.now());
  const [stats, setStats] = useState({ gapCount: 0, totalGapMs: 0, longestGapMs: 0 });

  const at = location?.lat != null && !location?.error ? location?.at : null;

  useMemo(() => {
    if (at == null) return;
    const lastAt = lastAtRef.current;
    lastAtRef.current = at;
    if (lastAt == null) return;
    const gap = at - lastAt;
    if (gap > GAP_THRESHOLD_MS) {
      setStats((prev) => ({
        gapCount: prev.gapCount + 1,
        totalGapMs: prev.totalGapMs + gap,
        longestGapMs: Math.max(prev.longestGapMs, gap),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  return { ...stats, sinceStartMs: Date.now() - startRef.current };
}
