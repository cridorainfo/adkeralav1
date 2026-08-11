import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMapEvents } from 'react-leaflet';
import { api } from '../lib/api.js';

// Same free OpenStreetMap tile source FleetMap.jsx already uses — no API key, no paid geo-API
// anywhere in this panel. Stop-marking is just "click the map", same as any consumer map app.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap';
const DEFAULT_CENTER = [25.2, 55.3]; // Dubai — this whole panel exists for that commute test
const DEFAULT_RADIUS_M = 80;

function ClickToAddStop({ onAdd }) {
  useMapEvents({
    click(e) {
      onAdd(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function TestLabPanel() {
  const [routes, setRoutes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null); // full route incl. events, fetched on select
  const [name, setName] = useState('');
  const [stops, setStops] = useState([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const json = await api('/api/testlab/routes');
    setRoutes(json.routes ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    const json = await api(`/api/testlab/routes/${encodeURIComponent(id)}`);
    setDetail(json.route ?? null);
  }, []);

  function selectRoute(route) {
    setSelectedId(route?.id ?? null);
    setName(route?.name ?? '');
    setStops(route?.stops ?? []);
    loadDetail(route?.id ?? null);
    setMessage('');
  }

  function newRoute() {
    setSelectedId(null);
    setName('');
    setStops([]);
    setDetail(null);
    setMessage('');
  }

  function addStop(lat, lng) {
    setStops((prev) => [
      ...prev,
      { en: `Stop ${prev.length + 1}`, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), radiusM: DEFAULT_RADIUS_M },
    ]);
  }

  function updateStop(index, patch) {
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeStop(index) {
    setStops((prev) => prev.filter((_, i) => i !== index));
  }

  function moveStop(index, dir) {
    setStops((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!name.trim() || stops.length === 0) {
      setMessage('Name and at least one stop are required.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      if (selectedId) {
        await api(`/api/testlab/routes/${encodeURIComponent(selectedId)}`, {
          method: 'PUT',
          body: JSON.stringify({ name, stops }),
        });
        setMessage('Saved.');
      } else {
        const json = await api('/api/testlab/routes', { method: 'POST', body: JSON.stringify({ name, stops }) });
        setSelectedId(json.route.id);
        setMessage('Created.');
      }
      await load();
    } catch (err) {
      setMessage(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this test route and its event log?')) return;
    await api(`/api/testlab/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (id === selectedId) newRoute();
    await load();
  }

  const mapCenter = useMemo(() => {
    if (stops.length) return [stops[0].lat, stops[0].lng];
    return DEFAULT_CENTER;
  }, [stops]);

  const polyline = useMemo(() => stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat, s.lng]), [stops]);

  return (
    <div className="card">
      <h2>Test Lab</h2>
      <p className="hint">
        Isolated GPS auto-stop-progression reliability test — this data is never read by the live
        fleet or driver app. Mark stops here, then load this route in the standalone{' '}
        <code>AdKerala GPS Test</code> app to walk/drive it.
      </p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 220px' }}>
          <label>Test routes</label>
          <button type="button" className="btn btn-primary btn-sm" onClick={newRoute}>
            + New test route
          </button>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
            {routes.map((r) => (
              <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 0' }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ flex: 1, textAlign: 'left', fontWeight: r.id === selectedId ? 700 : 400 }}
                  onClick={() => selectRoute(r)}
                >
                  {r.name} ({r.stops.length})
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>
                  ×
                </button>
              </li>
            ))}
            {!routes.length && <li className="hint">No test routes yet.</li>}
          </ul>
        </div>

        <div style={{ flex: 1 }}>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dubai commute — home to office" />

          <label>Map — click to add a stop, in order</label>
          <div style={{ height: 360, borderRadius: 8, overflow: 'hidden' }}>
            <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
              <ClickToAddStop onAdd={addStop} />
              {polyline.length > 1 && <Polyline positions={polyline} pathOptions={{ color: '#2d6cdf', weight: 3 }} />}
              {stops.map((s, i) => (
                <div key={i}>
                  <Marker position={[s.lat, s.lng]} />
                  <Circle center={[s.lat, s.lng]} radius={s.radiusM ?? DEFAULT_RADIUS_M} pathOptions={{ color: '#2d6cdf', fillOpacity: 0.08 }} />
                </div>
              ))}
            </MapContainer>
          </div>

          <table className="data-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Lat</th>
                <th>Lng</th>
                <th>Radius (m)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <input value={s.en} onChange={(e) => updateStop(i, { en: e.target.value })} />
                  </td>
                  <td>{s.lat?.toFixed(5)}</td>
                  <td>{s.lng?.toFixed(5)}</td>
                  <td>
                    <input
                      type="number"
                      value={s.radiusM ?? DEFAULT_RADIUS_M}
                      onChange={(e) => updateStop(i, { radiusM: Number(e.target.value) || DEFAULT_RADIUS_M })}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => moveStop(i, -1)} disabled={i === 0}>
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => moveStop(i, 1)}
                      disabled={i === stops.length - 1}
                    >
                      ↓
                    </button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => removeStop(i)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!stops.length && (
                <tr>
                  <td colSpan={6} className="hint">
                    Click the map to add stops, in the order the bus/commute passes them.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <button type="button" className="btn btn-primary" onClick={save} disabled={saving} style={{ marginTop: 12 }}>
            {saving ? 'Saving…' : selectedId ? 'Save changes' : 'Create test route'}
          </button>
          {message && <p className="hint">{message}</p>}
        </div>
      </div>

      {detail && (
        <div style={{ marginTop: 32 }}>
          <h3>Event log — {detail.name}</h3>
          <p className="hint">
            Latest first. Populated live by the standalone test app as it runs — refresh this page to see new events land.
          </p>
          <div className="event-log-admin">
            {(detail.events ?? [])
              .slice()
              .reverse()
              .map((ev, i) => (
                <div key={i} className={`ev-row ev-${ev.type}`}>
                  <span className="ev-time">{new Date(ev.at).toLocaleString()}</span>
                  <span className="ev-type">{ev.type}</span>
                  <span className="ev-msg">{ev.message}</span>
                  {ev.direction && <span className="ev-dir">({ev.direction === 'reverse' ? 'Going Home' : 'Going to Office'})</span>}
                </div>
              ))}
            {!(detail.events ?? []).length && <p className="hint">No events yet — start a test run on the phone.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
