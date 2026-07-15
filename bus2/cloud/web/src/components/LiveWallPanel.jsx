import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import BusPreviewCard from './BusPreviewCard.jsx';
import BusAdAnalyticsPanel from './BusAdAnalyticsPanel.jsx';
import { busDisplayLabel } from './BusContext.jsx';

function formatMoney(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function LiveWallPanel() {
  const [buses, setBuses] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [summary, setSummary] = useState({ totalConsumed: 0, totalBudget: 0 });
  const [error, setError] = useState('');

  const refreshWall = useCallback(async () => {
    try {
      const json = await api('/api/buses/live-wall');
      setBuses(json.buses ?? []);
      setError('');
    } catch (err) {
      setError(err.message ?? 'Could not load live wall');
    }
  }, []);

  const refreshSummary = useCallback(async () => {
    try {
      const json = await api('/api/analytics/ads-fleet?summaryOnly=1');
      setSummary({
        totalConsumed: json.totalConsumed ?? 0,
        totalBudget: json.totalBudget ?? 0,
      });
    } catch {
      /* keep last known summary */
    }
  }, []);

  useEffect(() => {
    refreshWall();
    const t = setInterval(refreshWall, 5000);
    return () => clearInterval(t);
  }, [refreshWall]);

  useEffect(() => {
    refreshSummary();
    const t = setInterval(refreshSummary, 30000);
    return () => clearInterval(t);
  }, [refreshSummary]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return buses;
    return buses.filter((bus) => {
      const plate = (bus.profile?.plateDisplay || bus.profile?.plate || '').toLowerCase();
      const name = (bus.profile?.displayName || '').toLowerCase();
      const id = (bus.busId || '').toLowerCase();
      const label = busDisplayLabel(bus).toLowerCase();
      return plate.includes(q) || name.includes(q) || id.includes(q) || label.includes(q);
    });
  }, [buses, search]);

  const selectedBus = buses.find((b) => b.busId === selectedBusId) ?? null;

  function handleSelectAnalytics(busId) {
    setSelectedBusId((prev) => (prev === busId ? null : busId));
  }

  return (
    <div className="live-wall">
      <div className="card live-wall-toolbar">
        <div className="live-wall-toolbar-row">
          <div className="form-group live-wall-search">
            <label htmlFor="live-wall-search">Search buses</label>
            <input
              id="live-wall-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, plate, or bus ID"
            />
          </div>
          <div className="live-wall-money-strip" title="Fleet-wide budgeted ad spend vs total budgets">
            <div>
              <span className="hint">Consumed</span>
              <strong>{formatMoney(summary.totalConsumed)}</strong>
            </div>
            <div className="live-wall-money-sep">/</div>
            <div>
              <span className="hint">Total</span>
              <strong>{formatMoney(summary.totalBudget)}</strong>
            </div>
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          {filtered.length} bus{filtered.length === 1 ? '' : 'es'}
          {search.trim() ? ' matching' : ''} · previews refresh every ~5s · new claimed buses appear automatically
        </p>
        {error && (
          <p className="hint" style={{ color: '#dc2626', marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>

      {!buses.length && !error && (
        <div className="card">
          <p className="empty-state">No buses in the fleet yet. Claim a bus to see it here.</p>
        </div>
      )}

      {buses.length > 0 && !filtered.length && (
        <div className="card">
          <p className="empty-state">No buses match “{search.trim()}”.</p>
        </div>
      )}

      <div className="live-wall-grid">
        {filtered.map((bus) => (
          <BusPreviewCard
            key={bus.busId}
            bus={bus}
            selected={bus.busId === selectedBusId}
            onSelectAnalytics={handleSelectAnalytics}
          />
        ))}
      </div>

      {selectedBusId && (
        <BusAdAnalyticsPanel
          busId={selectedBusId}
          busLabel={selectedBus ? busDisplayLabel(selectedBus) : selectedBusId}
        />
      )}
    </div>
  );
}
