import { useState } from 'react';
import { useCloudRouteSearch } from '../hooks/useCloudRouteSearch';

export default function CloudRoutePicker({ onAssigned }) {
  const { routes, loading, error, cloudEnabled, search, assignToBus } = useCloudRouteSearch();
  const [query, setQuery] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [message, setMessage] = useState(null);

  if (!cloudEnabled) return null;

  const handleSearch = (e) => {
    e.preventDefault();
    search(query);
  };

  const handleAssign = async (routeId) => {
    setAssigning(routeId);
    setMessage(null);
    try {
      await assignToBus(routeId);
      setMessage('Route assigned — syncing to bus display…');
      onAssigned?.();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className="panel cloud-route-picker">
      <h3 className="panel-title">☁️ Cloud routes</h3>
      <p className="panel-hint">Search the central catalog and assign to this bus only.</p>
      <form onSubmit={handleSearch} className="cloud-route-search-form">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search route name or city…"
        />
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
      {error && <p className="storage-error-inline">{error}</p>}
      {message && <p className="cloud-route-message">{message}</p>}
      <ul className="cloud-route-list">
        {routes.map((route) => (
          <li key={route.id} className="cloud-route-item">
            <div>
              <strong>{route.name}</strong>
              <small>
                {route.startStop?.en} → {route.endStop?.en}
              </small>
            </div>
            <button
              type="button"
              className="btn btn-outline"
              disabled={assigning === route.id}
              onClick={() => handleAssign(route.id)}
            >
              {assigning === route.id ? 'Assigning…' : 'Use route'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
