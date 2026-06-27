import { useCallback, useEffect, useRef, useState } from 'react';
import { matchRoutesByEndpoints } from '../lib/routeMatch';

const DEBOUNCE_MS = 450;

/**
 * Suggest existing routes when user enters start + end stop names while creating a route.
 * Merges local routes with cloud catalog matches.
 */
export function useRouteEndpointSuggestions(localRoutes = [], cloudEnabled = false) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(
    async (startEn, endEn) => {
      const start = String(startEn ?? '').trim();
      const end = String(endEn ?? '').trim();
      if (!start || !end) {
        setMatches([]);
        return;
      }

      setLoading(true);
      try {
        const localHits = matchRoutesByEndpoints(localRoutes, start, end);
        let cloudHits = [];

        if (cloudEnabled) {
          const params = new URLSearchParams({ start, end });
          const res = await fetch(`/api/cloud/routes/match?${params}`);
          const json = await res.json();
          if (json.ok) cloudHits = json.matches ?? [];
        }

        const merged = [];
        const seen = new Set();

        for (const hit of [...localHits, ...cloudHits]) {
          const id = hit.route?.id ?? hit.route?.name;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          merged.push({
            ...hit,
            source: localHits.some((l) => l.route?.id === id) ? 'local' : 'cloud',
          });
        }

        setMatches(merged);
      } catch {
        setMatches(matchRoutesByEndpoints(localRoutes, startEn, endEn));
      } finally {
        setLoading(false);
      }
    },
    [localRoutes, cloudEnabled]
  );

  const scheduleRefresh = useCallback(
    (startEn, endEn) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => refresh(startEn, endEn), DEBOUNCE_MS);
    },
    [refresh]
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { matches, loading, scheduleRefresh, refresh };
}
