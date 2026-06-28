import { useEffect, useState } from 'react';
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
  const { selectedBusId, pushToBus, targetBusIds } = useSelectedBus();
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState(null);
  const [status, setStatus] = useState('');

  async function loadRoutes() {
    const json = await api('/api/routes');
    setRoutes(json.routes ?? []);
  }

  useEffect(() => {
    loadRoutes();
  }, []);

  function newRoute() {
    setRoute({
      id: `route-${Date.now()}`,
      name: '',
      startStop: emptyStop(),
      endStop: emptyStop(),
      stops: [],
    });
  }

  function selectRoute(id) {
    const found = routes.find((r) => r.id === id);
    if (found) setRoute(JSON.parse(JSON.stringify(found)));
  }

  async function saveRoute(andPush) {
    if (!route) return;
    setStatus('Saving…');
    const payload = {
      ...route,
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

    setRoute(json.route);
    setStatus(
      andPush && pushToBus && targetBusIds.length
        ? `Saved · queued for ${targetBusIds.join(', ')}`
        : 'Saved'
    );
    loadRoutes();
  }

  async function assignRoute() {
    await saveRoute(false);
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/assign-route`, {
      method: 'POST',
      body: JSON.stringify({ routeId: route.id }),
    });
    setStatus(`Assigned & queued for ${selectedBusId}`);
  }

  async function deleteRoute() {
    if (!route || !confirm(`Delete route "${route.name}"?`)) return;
    await api(`/api/routes/${encodeURIComponent(route.id)}`, {
      method: 'DELETE',
      body: JSON.stringify({ targetBusIds: pushToBus ? targetBusIds : [] }),
    });
    setRoute(null);
    setStatus('Deleted');
    loadRoutes();
  }

  if (!route) {
    return (
      <div className="card">
        <h2>Route editor</h2>
        <p className="hint">Create or edit routes with bilingual stops and GPS coordinates.</p>
        <div className="editor-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={loadRoutes}>
            Load routes
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={newRoute}>
            New route
          </button>
        </div>
        <select onChange={(e) => selectRoute(e.target.value)} defaultValue="">
          <option value="">— select route —</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Route editor</h2>
      <p className="hint">Changes save to the cloud catalog. Enable push to queue updates on the selected bus.</p>
      <div className="editor-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={loadRoutes}>
          Reload list
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={newRoute}>
          New route
        </button>
        <select value={route.id} onChange={(e) => selectRoute(e.target.value)}>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
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
        <button type="button" className="btn btn-primary btn-sm" onClick={() => saveRoute(false)}>
          Save catalog
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => saveRoute(true)}>
          Push route to bus
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={assignRoute}>
          Assign & activate
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={deleteRoute}>
          Delete route
        </button>
      </div>
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
