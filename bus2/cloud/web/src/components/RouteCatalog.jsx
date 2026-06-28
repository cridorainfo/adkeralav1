import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

export default function RouteCatalog() {
  const { selectedBusId, buses } = useSelectedBus();
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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

  async function assign(routeId) {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setError('Select your claimed bus in the toolbar above first.');
      return;
    }
    setError('');
    setMessage('');
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}/assign-route`, {
        method: 'POST',
        body: JSON.stringify({ routeId }),
      });
      setMessage(`Route queued for ${selectedBusId} — bus applies within ~5s when online.`);
    } catch (err) {
      setError(err.message ?? 'Assign failed');
    }
  }

  return (
    <div className="card">
      <h2>Route catalog</h2>
      <p className="hint">Browse shared routes and assign one to the selected bus.</p>
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
            <th>Name</th>
            <th>Start</th>
            <th>End</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>{r.startStop?.en}</td>
              <td>{r.endStop?.en}</td>
              <td>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => assign(r.id)}>
                  Assign to bus
                </button>
              </td>
            </tr>
          ))}
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
