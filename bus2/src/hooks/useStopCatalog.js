import { useCallback, useEffect, useState } from 'react';

/** Search and sync shared stop catalog from cloud. */
export function useStopCatalog() {
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/cloud/config')
      .then((r) => r.json())
      .then((json) => setCloudEnabled(Boolean(json.enabled)))
      .catch(() => setCloudEnabled(false));
  }, []);

  const searchStops = useCallback(async (query) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cloud/stops/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Stop search failed');
      return json.stops ?? [];
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAllStops = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cloud/stops');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Could not load stops');
      return json.stops ?? [];
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const upsertStop = useCallback(async (stop) => {
    setError(null);
    try {
      const res = await fetch('/api/cloud/stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stop),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Could not save stop');
      return json.stop;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  }, []);

  return { cloudEnabled, loading, error, searchStops, fetchAllStops, upsertStop };
}
