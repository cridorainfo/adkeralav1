import { useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

export default function RouteCatalog() {
  const { selectedBusId } = useSelectedBus();
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState([]);
  const [message, setMessage] = useState('');

  async function search() {
    const json = await api(`/api/routes/search?q=${encodeURIComponent(query)}`);
    setRoutes(json.routes ?? []);
  }

  async function assign(routeId) {
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/assign-route`, {
      method: 'POST',
      body: JSON.stringify({ routeId }),
    });
    setMessage(`Route queued for ${selectedBusId}`);
  }

  return (
    <div className="card">
      <h2>Route catalog</h2>
      <div className="toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search routes…" />
        <button type="button" className="btn btn-primary btn-sm" onClick={search}>
          Search
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
      {message && <p className="hint">{message}</p>}
      {!routes.length && <p className="empty-state">Search to find routes.</p>}
    </div>
  );
}
