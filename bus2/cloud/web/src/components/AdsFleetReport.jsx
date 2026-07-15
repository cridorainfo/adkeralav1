import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function formatMoney(value) {
  const n = Number(value) || 0;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export default function AdsFleetReport() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const json = await api('/api/analytics/ads-fleet');
      setData(json);
    } catch (err) {
      setData(null);
      setError(err.message ?? 'Could not load ads report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="card">
      <h2>Ads report — all buses</h2>
      <p className="hint">
        Fleet-wide plays and spend for every campaign ad and house ad. Consumed / Total only count
        budgeted (paid) ads.
      </p>

      {loading && <p className="hint">Loading…</p>}
      {error && (
        <p className="hint" style={{ color: '#dc2626' }}>
          {error}
        </p>
      )}

      {data && (
        <>
          <div className="live-wall-analytics-summary ads-fleet-summary">
            <div>
              <span className="hint">Consumed</span>
              <strong>{formatMoney(data.totalConsumed)}</strong>
            </div>
            <div>
              <span className="hint">Total budget</span>
              <strong>{formatMoney(data.totalBudget)}</strong>
            </div>
            <div>
              <span className="hint">Total plays</span>
              <strong>{data.totalPlays ?? 0}</strong>
            </div>
          </div>

          {!data.ads?.length ? (
            <p className="empty-state">No ads in campaigns or house ads yet.</p>
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
