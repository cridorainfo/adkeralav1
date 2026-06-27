import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function StopsCatalog() {
  const [stops, setStops] = useState([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ en: '', ml: '', lat: '', lng: '', radiusM: 80 });
  const [message, setMessage] = useState('');

  async function load(q = '') {
    const path = q ? `/api/stops/search?q=${encodeURIComponent(q)}` : '/api/stops';
    const json = await api(path);
    setStops(json.stops ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function saveStop(e) {
    e.preventDefault();
    setMessage('');
    await api('/api/stops', {
      method: 'POST',
      body: JSON.stringify({
        en: form.en,
        ml: form.ml,
        lat: form.lat === '' ? null : Number(form.lat),
        lng: form.lng === '' ? null : Number(form.lng),
        radiusM: Number(form.radiusM) || 80,
      }),
    });
    setMessage('Stop saved');
    setForm({ en: '', ml: '', lat: '', lng: '', radiusM: 80 });
    load(query);
  }

  return (
    <div className="card">
      <h2>Stops catalog</h2>
      <p className="hint">Shared stop library with GPS coordinates used across routes.</p>
      <div className="toolbar">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stops…" />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => load(query)}>
          Search
        </button>
      </div>
      <form onSubmit={saveStop} className="inline-form" style={{ marginBottom: '1rem' }}>
        <div className="form-group">
          <label>English</label>
          <input value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Malayalam</label>
          <input value={form.ml} onChange={(e) => setForm({ ...form, ml: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Lat</label>
          <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Lng</label>
          <input value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
        </div>
        <button type="submit" className="btn btn-primary btn-sm">
          Add / update stop
        </button>
      </form>
      {message && <p className="hint">{message}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>English</th>
            <th>Malayalam</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((s, i) => (
            <tr key={`${s.en}-${i}`}>
              <td>{s.en}</td>
              <td>{s.ml || '—'}</td>
              <td>{s.lat != null ? `${s.lat}, ${s.lng}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
