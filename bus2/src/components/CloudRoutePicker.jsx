import { useEffect, useState } from 'react';
import { useCloudRouteSearch } from '../hooks/useCloudRouteSearch';
import { useBusStore } from '../hooks/useBusStore';
import SharedRouteRow from './SharedRouteRow';
import { isCloudRouteOnBus } from '../lib/routeMatch';

export default function CloudRoutePicker({ onAssigned, compact = false }) {
  const { state, commitServerState } = useBusStore();
  const busRoutes = state.routes ?? [];
  const { routes, loading, error, cloudEnabled, search, assignToBus } = useCloudRouteSearch();
  const [query, setQuery] = useState('');
  const [assigning, setAssigning] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (cloudEnabled) search('');
  }, [cloudEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cloudEnabled) return null;

  const handleSearch = (e) => {
    e.preventDefault();
    search(query);
  };

  const handleAssign = async (routeId) => {
    setAssigning(routeId);
    setMessage(null);
    try {
      const json = await assignToBus(routeId);
      if (json.state) {
        commitServerState(json.state);
      }
      setMessage('Route added to this bus — display will update shortly.');
      onAssigned?.(json.route);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setAssigning(null);
    }
  };

  return (
    <div className={`panel cloud-route-picker ${compact ? 'cloud-route-picker--compact' : ''}`}>
      <h3 className="panel-title">{compact ? '☁️ Pick a shared route' : '☁️ Shared routes (all drivers)'}</h3>
      <p className="panel-hint">
        {compact
          ? 'Browse shared routes and tap Add to load one on this bus.'
          : 'Routes shared by any driver appear here. Expand for stop details, then Add to load on this bus.'}
      </p>
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
      <ul className="cloud-route-list shared-route-list">
        {routes.map((route) => {
          const middle = route.stops?.length ?? 0;
          const stopCount = 2 + middle;
          return (
            <SharedRouteRow
              key={route.id}
              route={route}
              subtitle={`${route.startStop?.en} → ${route.endStop?.en} · ${stopCount} stop${stopCount === 1 ? '' : 's'}`}
              onAdd={() => handleAssign(route.id)}
              adding={assigning === route.id}
              addLabel="Add"
              alreadyAdded={isCloudRouteOnBus(busRoutes, route)}
            />
          );
        })}
        {!loading && routes.length === 0 && (
          <li className="cloud-route-empty">
            No shared routes yet. Ask admin to add routes in the cloud catalog.
          </li>
        )}
      </ul>
    </div>
  );
}
