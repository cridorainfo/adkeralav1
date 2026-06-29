import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api.js';

function stopsLink(basePath, gap) {
  const missing = gap.missing?.find((m) => m === 'gps_coords' || m === 'malayalam_text' || m === 'english_name');
  const params = new URLSearchParams();
  if (missing) params.set('missing', missing);
  if (gap.stopEn) params.set('highlight', gap.stopEn);
  const qs = params.toString();
  return `${basePath}/stops${qs ? `?${qs}` : ''}`;
}

export default function ContentGaps() {
  const location = useLocation();
  const stopsBase = location.pathname.startsWith('/owner') ? '/owner' : '/admin';
  const [gaps, setGaps] = useState([]);

  const audioGaps = useMemo(
    () => gaps.filter((g) => g.missing?.includes('stop_audio')),
    [gaps]
  );
  const otherGaps = useMemo(
    () => gaps.filter((g) => g.missing?.some((m) => m !== 'stop_audio')),
    [gaps]
  );

  async function load() {
    const json = await api('/api/content-gaps');
    setGaps(json.gaps ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="card">
      <h2>Content gaps</h2>
      <p className="hint">
        Missing Malayalam names, GPS coordinates, or audio metadata. Fix names and GPS in the{' '}
        <Link to={`${stopsBase}/stops`}>Stops hub</Link> (supports phone GPS capture).
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={load}>
        Refresh
      </button>

      {otherGaps.length > 0 && (
        <table className="data-table" style={{ marginTop: '1rem' }}>
          <thead>
            <tr>
              <th>Route</th>
              <th>Stop</th>
              <th>Missing</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            {otherGaps.map((gap, i) => (
              <tr key={`${gap.routeId}-${gap.stopEn}-${i}`}>
                <td>{gap.routeName}</td>
                <td>
                  {gap.stopEn}
                  {gap.stopMl ? ` / ${gap.stopMl}` : ''}
                </td>
                <td>{gap.missing?.filter((m) => m !== 'stop_audio').map((m) => <span key={m} className="gap-tag">{m}</span>)}</td>
                <td>
                  <Link className="btn btn-secondary btn-sm" to={stopsLink(stopsBase, gap)}>
                    Open in Stops
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {audioGaps.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.25rem' }}>Missing stop audio</h3>
          <p className="hint">Upload voice clips in the Voices tab.</p>
          <table className="data-table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Stop</th>
                <th>Missing</th>
              </tr>
            </thead>
            <tbody>
              {audioGaps.map((gap, i) => (
                <tr key={`audio-${gap.routeId}-${gap.stopEn}-${i}`}>
                  <td>{gap.routeName}</td>
                  <td>{gap.stopEn}</td>
                  <td><span className="gap-tag">stop_audio</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!gaps.length && <p className="empty-state">No content gaps found.</p>}
    </div>
  );
}
