import { useCallback, useEffect, useRef, useState } from 'react';
import { stopKey } from '../lib/stopCatalog';
import { useStopCatalog } from './useStopCatalog';

function mergeStopHits(local = [], cloud = []) {
  const seen = new Set();
  const out = [];
  for (const stop of [...local, ...cloud]) {
    const key = stopKey(stop.en);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(stop);
  }
  return out.slice(0, 12);
}

/** Local + cloud stop library search for autocomplete fields. */
export function useStopSearch(stopCatalog = [], onMergeCatalog) {
  const { cloudEnabled, searchStops, fetchAllStops } = useStopCatalog();
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const timerRef = useRef(null);
  const catalogRef = useRef(stopCatalog);
  catalogRef.current = stopCatalog;

  useEffect(() => {
    if (!cloudEnabled) return;
    fetchAllStops().then((stops) => {
      if (stops.length) onMergeCatalog?.(stops);
    });
  }, [cloudEnabled, fetchAllStops, onMergeCatalog]);

  const searchLocal = useCallback((query) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalogRef.current
      .filter((s) => s.en?.toLowerCase().includes(q) || s.ml?.toLowerCase().includes(q))
      .slice(0, 12);
  }, []);

  const scheduleSearch = useCallback(
    (query, field) => {
      setActiveField(field);
      const q = query.trim();
      if (!q) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      setSuggestions(searchLocal(q));

      if (!cloudEnabled) return;

      clearTimeout(timerRef.current);
      setLoading(true);
      timerRef.current = setTimeout(async () => {
        try {
          const cloudHits = await searchStops(q);
          if (cloudHits.length) onMergeCatalog?.(cloudHits);
          setSuggestions(mergeStopHits(searchLocal(q), cloudHits));
        } finally {
          setLoading(false);
        }
      }, 280);
    },
    [cloudEnabled, onMergeCatalog, searchLocal, searchStops]
  );

  const clearSuggestions = useCallback(() => {
    setActiveField(null);
    setSuggestions([]);
    setLoading(false);
    clearTimeout(timerRef.current);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return {
    suggestions,
    loading,
    activeField,
    setActiveField,
    scheduleSearch,
    clearSuggestions,
  };
}
