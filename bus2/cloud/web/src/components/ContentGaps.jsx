import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

export default function ContentGaps() {
  const { selectedBusId } = useSelectedBus();
  const [gaps, setGaps] = useState([]);

  async function load() {
    const json = await api('/api/content-gaps');
    setGaps(json.gaps ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function fixGap(gap) {
    const ml = prompt(`Malayalam name for ${gap.stopEn}`, gap.stopMl ?? '');
    if (ml == null) return;
    const lat = prompt('Latitude (optional)', '');
    const lng = prompt('Longitude (optional)', '');
    const patch = { ml };
    if (lat) patch.lat = Number(lat);
    if (lng) patch.lng = Number(lng);
    await api(`/api/routes/${encodeURIComponent(gap.routeId)}/stops/${encodeURIComponent(gap.stopEn)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...patch, targetBusIds: [selectedBusId] }),
    });
    load();
  }

  return (
    <div className="card">
      <h2>Content gaps</h2>
      <p className="hint">Missing Malayalam names, GPS coordinates, or audio metadata.</p>
      <button type="button" className="btn btn-primary btn-sm" onClick={load}>
        Refresh
      </button>
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
          {gaps.map((gap, i) => (
            <tr key={i}>
              <td>{gap.routeName}</td>
              <td>
                {gap.stopEn}
                {gap.stopMl ? ` / ${gap.stopMl}` : ''}
              </td>
              <td>{gap.missing?.map((m) => <span key={m} className="gap-tag">{m}</span>)}</td>
              <td>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fixGap(gap)}>
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!gaps.length && <p className="empty-state">No content gaps found.</p>}
    </div>
  );
}
