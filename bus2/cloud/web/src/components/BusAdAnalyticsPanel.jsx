import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { busDisplayLabel } from './BusContext.jsx';

function formatMoney(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function BusAdAnalyticsPanel({ busId, busLabel }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!busId) return;
    setError('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(busId)}/ad-analytics`);
      setData(json);
    } catch (err) {
      setData(null);
      setError(err.message ?? 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [busId]);

  useEffect(() => {
    setLoading(true);
    setData(null);
    refresh();
  }, [refresh]);

  const title = busLabel || busDisplayLabel({ busId });

  return (
    <div className="card live-wall-analytics">
      <h2>Ad analytics — {title}</h2>
      <p className="hint">
        Plays and spend recorded for ads that ran on this bus (same pricing engine as Campaigns).
      </p>
      {loading && <p className="hint">Loading…</p>}
      {error && (
        <p className="hint" style={{ color: '#dc2626' }}>
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="live-wall-analytics-summary">
            <div>
              <span className="hint">Total plays</span>
              <strong>{data.totalPlays ?? 0}</strong>
            </div>
            <div>
              <span className="hint">Money consumed</span>
              <strong>{formatMoney(data.totalSpend)}</strong>
            </div>
          </div>
          {!data.ads?.length ? (
            <p className="empty-state">No ad plays recorded for this bus yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ad</th>
                  <th>Format</th>
                  <th>Source</th>
                  <th>Plays</th>
                  <th>Spend</th>
                  <th>Budget</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.ads.map((ad) => (
                  <tr key={`${ad.adId}-${ad.format}`}>
                    <td>{ad.name}</td>
                    <td>{ad.format}</td>
                    <td>{ad.source}</td>
                    <td>{ad.plays}</td>
                    <td>{formatMoney(ad.spend)}</td>
                    <td>{ad.budget != null ? formatMoney(ad.budget) : '—'}</td>
                    <td>
                      {ad.isHouseAd ? (
                        <span className="hint">always on</span>
                      ) : ad.exhausted ? (
                        <span className="version-pill version-below">budget exhausted</span>
                      ) : ad.budget != null ? (
                        <span className="version-pill version-current">active</span>
                      ) : (
                        <span className="hint">unbudgeted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
