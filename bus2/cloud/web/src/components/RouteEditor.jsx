import { useCallback, useEffect, useState } from 'react';
import { api, uploadMedia, fleetBroadcast } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

const emptyStop = () => ({ en: '', ml: '', lat: '', lng: '', radiusM: 80 });

function StopRow({ stop, onChange, onRemove, showRemove }) {
  const fields = ['en', 'ml', 'lat', 'lng', 'radiusM'];
  const labels = { en: 'English', ml: 'Malayalam', lat: 'Lat', lng: 'Lng', radiusM: 'Radius' };

  return (
    <div className="stop-row">
      {fields.map((f) => (
        <input
          key={f}
          placeholder={labels[f]}
          value={stop[f] ?? ''}
          onChange={(e) => onChange({ ...stop, [f]: e.target.value })}
        />
      ))}
      <input type="file" accept="audio/*" title="Stop voice (EN)" onChange={(e) => onChange({ ...stop, _voiceFile: e.target.files?.[0] })} />
      {showRemove && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}

export default function RouteEditor() {
  const { selectedBusId, pushToBus, targetBusIds, buses } = useSelectedBus();
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadRoutes = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const json = await api('/api/routes');
      setRoutes(json.routes ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load routes');
      setRoutes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  function newRoute() {
    setError('');
    setStatus('');
    setRoute({
      id: `route-${Date.now()}`,
      name: '',
      startStop: emptyStop(),
      endStop: emptyStop(),
      stops: [],
    });
  }

  function selectRoute(id) {
    if (!id) return;
    const found = routes.find((r) => r.id === id);
    if (found) {
      setError('');
      setRoute(JSON.parse(JSON.stringify(found)));
    }
  }

  async function saveRoute(andPush) {
    if (!route) return;
    if (!route.name?.trim()) {
      setError('Enter a route name before saving.');
      return;
    }
    if (!route.startStop?.en?.trim() || !route.endStop?.en?.trim()) {
      setError('Start and end stops need English names.');
      return;
    }

    setBusy(true);
    setError('');
    setStatus('Saving…');
    try {
      const payload = {
        ...route,
        name: route.name.trim(),
        startStop: normalizeStop(route.startStop),
        endStop: normalizeStop(route.endStop),
        stops: route.stops.map(normalizeStop),
        targetBusIds: andPush && pushToBus ? targetBusIds : [],
      };

      const json = await api(`/api/routes/${encodeURIComponent(route.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      const stopAudio = {};
      const mediaFiles = [];
      for (const s of [route.startStop, ...route.stops, route.endStop]) {
        if (s._voiceFile && s.en) {
          const up = await uploadMedia(s._voiceFile, 'stops');
          const key = s.en.toLowerCase();
          stopAudio[key] = { en: { audioFile: up.path } };
          mediaFiles.push(up.path);
        }
      }

      if (Object.keys(stopAudio).length && andPush && pushToBus && targetBusIds.length) {
        await fleetBroadcast({
          targetBusIds,
          commandType: 'MERGE_STATE',
          payload: { stopAudio, mediaFiles },
        });
      }

      if (andPush && pushToBus && targetBusIds.length) {
        try {
          const phrases = await api('/api/announcements/phrases/catalog');
          if (phrases?.audioFragments && Object.keys(phrases.audioFragments).length) {
            await fleetBroadcast({
              targetBusIds,
              commandType: 'MERGE_STATE',
              payload: {
                audioFragments: phrases.audioFragments,
                mediaFiles: phrases.mediaFiles ?? [],
              },
            });
          }
        } catch {
          /* phrase catalog optional */
        }
      }

      setRoute(json.route);
      setStatus(
        andPush && pushToBus && targetBusIds.length
          ? `Saved · queued for ${targetBusIds.join(', ')}`
          : 'Saved to catalog'
      );
      await loadRoutes();
    } catch (err) {
      setError(err.message ?? 'Save failed');
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  async function assignRoute() {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setError('Select your claimed bus in the toolbar above first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await saveRoute(false);
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}/assign-route`, {
        method: 'POST',
        body: JSON.stringify({ routeId: route.id }),
      });
      setStatus(`Route assigned & queued for ${selectedBusId}`);
    } catch (err) {
      setError(err.message ?? 'Assign failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRoute() {
    if (!route || !confirm(`Delete route "${route.name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await api(`/api/routes/${encodeURIComponent(route.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ targetBusIds: pushToBus ? targetBusIds : [] }),
      });
      setRoute(null);
      setStatus('Deleted');
      await loadRoutes();
    } catch (err) {
      setError(err.message ?? 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (!route) {
    return (
      <div className="card">
        <h2>Route editor</h2>
        <p className="hint">Create or edit routes with bilingual stops and GPS coordinates.</p>
        {!buses?.length && (
          <p className="hint" style={{ color: '#b45309' }}>
            No buses in fleet yet — claim a bus first, then assign routes.
          </p>
        )}
        <div className="editor-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={loadRoutes} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh list'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={newRoute}>
            + New route
          </button>
        </div>
        <div className="form-group">
          <label htmlFor="route-pick">Select existing route</label>
          <select
            id="route-pick"
            value=""
            onChange={(e) => selectRoute(e.target.value)}
            disabled={loading || !routes.length}
          >
            <option value="">— select route —</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {!loading && !routes.length && (
          <p className="empty-state">No routes yet. Click <strong>+ New route</strong> to create one.</p>
        )}
        {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
        {status && <p className="hint">{status}</p>}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Route editor</h2>
      <p className="hint">
        Changes save to the cloud catalog. Enable <strong>push</strong> in the toolbar, then use Push or Assign.
      </p>
      <div className="editor-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRoute(null)}>
          ← Back to list
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={loadRoutes} disabled={loading}>
          Reload list
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={newRoute}>
          + New route
        </button>
        <select value={route.id} onChange={(e) => selectRoute(e.target.value)}>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name || r.id}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Route name</label>
        <input value={route.name} onChange={(e) => setRoute({ ...route, name: e.target.value })} />
      </div>
      <h3>Start stop</h3>
      <StopRow stop={route.startStop} onChange={(s) => setRoute({ ...route, startStop: s })} />
      <h3>Middle stops</h3>
      {route.stops.map((s, i) => (
        <StopRow
          key={i}
          stop={s}
          showRemove
          onChange={(updated) => {
            const stops = [...route.stops];
            stops[i] = updated;
            setRoute({ ...route, stops });
          }}
          onRemove={() => setRoute({ ...route, stops: route.stops.filter((_, j) => j !== i) })}
        />
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRoute({ ...route, stops: [...route.stops, emptyStop()] })}>
        + Add stop
      </button>
      <h3>End stop</h3>
      <StopRow stop={route.endStop} onChange={(s) => setRoute({ ...route, endStop: s })} />
      <div className="editor-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveRoute(false)}>
          Save catalog
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveRoute(true)}>
          Push route to bus
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={assignRoute}>
          Assign & activate
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={deleteRoute}>
          Delete route
        </button>
      </div>
      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {status && <p className="hint">{status}</p>}
    </div>
  );
}

function normalizeStop(s) {
  return {
    en: String(s.en ?? '').trim(),
    ml: String(s.ml ?? '').trim(),
    lat: s.lat === '' || s.lat == null ? null : Number(s.lat),
    lng: s.lng === '' || s.lng == null ? null : Number(s.lng),
    radiusM: s.radiusM === '' || s.radiusM == null ? 80 : Number(s.radiusM),
  };
}
