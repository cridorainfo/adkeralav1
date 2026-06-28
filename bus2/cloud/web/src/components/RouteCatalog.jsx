import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';
import { useBusAssignedRoutes } from '../hooks/useBusAssignedRoutes.js';
import { routeEndpointsLabel, routeStopCount, routeViaStopsSummary } from '../lib/routeLabels.js';

export default function RouteCatalog() {
  const { selectedBusId, buses } = useSelectedBus();
  const { isAssigned, refresh: refreshAssigned } = useBusAssignedRoutes(selectedBusId);
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState(null);

  const search = useCallback(async (q = query) => {
    setError('');
    setLoading(true);
    try {
      const path = q.trim()
        ? `/api/routes/search?q=${encodeURIComponent(q.trim())}`
        : '/api/routes';
      const json = await api(path);
      setRoutes(json.routes ?? []);
    } catch (err) {
      setError(err.message ?? 'Search failed');
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    search('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function assign(route) {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setError('Select your claimed bus in the toolbar above first.');
      return;
    }
    if (isAssigned(route.id)) {
      setMessage(`Already assigned to ${selectedBusId} (${route.id}).`);
      return;
    }
    setError('');
    setMessage('');
    setAssigningId(route.id);
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}/assign-route`, {
        method: 'POST',
        body: JSON.stringify({ routeId: route.id }),
      });
      setMessage(`Route ${route.id} queued for ${selectedBusId} — bus applies within ~5s when online.`);
      await refreshAssigned();
    } catch (err) {
      setError(err.message ?? 'Assign failed');
    } finally {
      setAssigningId(null);
    }
  }

  return (
    <div className="card">
      <h2>Route catalog</h2>
      <p className="hint">
        Browse shared routes and assign one to the selected bus. Routes with the same name or endpoints
        are distinguished by their unique <strong>Route ID</strong>.
      </p>
      {!buses?.length && (
        <p className="hint" style={{ color: '#b45309' }}>
          No buses in fleet — claim a bus first.
        </p>
      )}
      <div className="toolbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search routes…"
          onKeyDown={(e) => e.key === 'Enter' && search(query)}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => search(query)} disabled={loading}>
          {loading ? 'Loading…' : 'Search'}
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Route ID</th>
            <th>Name</th>
            <th>Start → End</th>
            <th>Stops</th>
            <th>Via</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => {
            const assigned = isAssigned(r.id);
            return (
              <tr key={r.id} className={assigned ? 'route-row-assigned' : undefined}>
                <td>
                  <code className="route-id-code">{r.id}</code>
                </td>
                <td>{r.name}</td>
                <td>{routeEndpointsLabel(r)}</td>
                <td>{routeStopCount(r)}</td>
                <td className="route-via-cell">{routeViaStopsSummary(r) || '—'}</td>
                <td>
                  {assigned ? (
                    <span className="route-assigned-badge" title={`Already on ${selectedBusId}`}>
                      ✓ Assigned
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={assigningId === r.id}
                      onClick={() => assign(r)}
                    >
                      {assigningId === r.id ? 'Assigning…' : 'Assign to bus'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p className="hint">{message}</p>}
      {!loading && !routes.length && (
        <p className="empty-state">
          No routes in catalog. Go to <strong>Routes</strong> tab and click <strong>+ New route</strong>.
        </p>
      )}
    </div>
  );
}
