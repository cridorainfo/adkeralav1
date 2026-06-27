import { useEffect, useState } from 'react';

/** Search central route catalog on cloud (when ADKERALA_CLOUD_URL is configured on bus server). */
export function useCloudRouteSearch() {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/cloud/config')
      .then((r) => r.json())
      .then((json) => setCloudEnabled(Boolean(json.enabled)))
      .catch(() => setCloudEnabled(false));
  }, []);

  const search = async (query) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/cloud/routes/search?q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Search failed');
      setRoutes(json.routes ?? []);
    } catch (err) {
      setError(err.message);
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  };

  const assignToBus = async (routeId) => {
    const res = await fetch('/api/cloud/assign-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routeId }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Could not assign route');
    return json;
  };

  return { routes, loading, error, cloudEnabled, search, assignToBus };
}
