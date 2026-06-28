import { useCallback, useEffect, useState } from 'react';
import { api, uploadMedia, fleetBroadcast } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';
import { useBusAssignedRoutes } from '../hooks/useBusAssignedRoutes.js';
import { createRouteId, routeSelectLabel } from '../lib/routeLabels.js';

const AUDIO_ACCEPT = 'audio/*,.mp3,.mpeg,.mpga,audio/mpeg';
const emptyStop = () => ({ en: '', ml: '', lat: '', lng: '', radiusM: 80 });

function basename(path) {
  if (!path) return '';
  const parts = String(path).split('/');
  return parts[parts.length - 1] || path;
}

function StopRow({ stop, onChange, onRemove, showRemove, savedAudioFile, onUploadFile, uploading }) {
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
      <div className="stop-audio-cell">
        <input
          type="file"
          accept={AUDIO_ACCEPT}
          title="Stop voice (EN) — MP3/MPEG supported"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUploadFile(file);
          }}
        />
        {uploading ? (
          <small className="hint">Uploading…</small>
        ) : savedAudioFile ? (
          <small className="hint">Saved: {basename(savedAudioFile)}</small>
        ) : (
          <small className="hint">No audio — pick MP3/MPEG</small>
        )}
      </div>
      {showRemove && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRemove}>
          ✕
        </button>
      )}
    </div>
  );
}

function audioFileForStop(stop, stopAudioCatalog) {
  if (!stop?.en) return stop?.audioEn ?? stop?._savedAudioFile ?? null;
  const key = stop.en.trim().toLowerCase();
  return stop.audioEn ?? stop._savedAudioFile ?? stopAudioCatalog[key]?.en?.audioFile ?? null;
}

function attachSavedAudio(route, stopAudioCatalog) {
  if (!route) return route;
  const withAudio = (stop) => {
    const file = audioFileForStop(stop, stopAudioCatalog);
    return file ? { ...stop, _savedAudioFile: file, audioEn: file } : stop;
  };
  return {
    ...route,
    startStop: withAudio(route.startStop),
    endStop: withAudio(route.endStop),
    stops: (route.stops ?? []).map(withAudio),
  };
}

export default function RouteEditor() {
  const { selectedBusId, pushToBus, targetBusIds, buses } = useSelectedBus();
  const { isAssigned, refresh: refreshAssigned } = useBusAssignedRoutes(selectedBusId);
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState(null);
  const [stopAudioCatalog, setStopAudioCatalog] = useState({});
  const [uploadingStopKey, setUploadingStopKey] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadStopAudio = useCallback(async () => {
    try {
      const json = await api('/api/stops/audio/catalog');
      setStopAudioCatalog(json.stopAudio ?? {});
    } catch (err) {
      setStopAudioCatalog({});
      console.warn('Stop audio catalog:', err.message);
    }
  }, []);

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
    loadStopAudio();
  }, [loadRoutes, loadStopAudio]);

  useEffect(() => {
    setRoute((prev) => (prev ? attachSavedAudio(prev, stopAudioCatalog) : null));
  }, [stopAudioCatalog]);

  const persistStopAudioEntry = useCallback(async (stopEn, file) => {
    const key = String(stopEn ?? '').trim().toLowerCase();
    if (!key) throw new Error('Enter the English stop name before uploading audio.');
    setUploadingStopKey(key);
    setError('');
    try {
      const up = await uploadMedia(file, 'stops');
      const relPath = up.path ?? up.audioFile;
      if (!relPath) throw new Error('Upload did not return a file path.');
      const stopAudio = { [key]: { en: { audioFile: relPath } } };
      const saved = await api('/api/stops/audio', {
        method: 'PUT',
        body: JSON.stringify({ stopAudio, mediaFiles: [relPath] }),
      });
      const merged = saved.stopAudio ?? { ...stopAudioCatalog, ...stopAudio };
      setStopAudioCatalog(merged);
      setStatus(`Audio saved for "${stopEn}"`);
      return relPath;
    } finally {
      setUploadingStopKey(null);
    }
  }, [stopAudioCatalog]);

  function newRoute() {
    setError('');
    setStatus('');
    setRoute({
      id: createRouteId(),
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
      setRoute(attachSavedAudio(JSON.parse(JSON.stringify(found)), stopAudioCatalog));
    }
  }

  async function handleStopAudioUpload(stop, file, applyStop) {
    try {
      const relPath = await persistStopAudioEntry(stop.en, file);
      applyStop({ ...stop, _savedAudioFile: relPath, audioEn: relPath, _voiceFile: null });
    } catch (err) {
      setError(err.message ?? 'Audio upload failed');
      setStatus('');
    }
  }

  async function uploadPendingVoiceFiles() {
    const stopAudio = {};
    const mediaFiles = [];
    for (const s of [route.startStop, ...route.stops, route.endStop]) {
      if (s._voiceFile && s.en) {
        const up = await uploadMedia(s._voiceFile, 'stops');
        const relPath = up.path ?? up.audioFile;
        const key = s.en.trim().toLowerCase();
        stopAudio[key] = { en: { audioFile: relPath } };
        mediaFiles.push(relPath);
      }
    }
    if (!Object.keys(stopAudio).length) return { stopAudio: {}, mediaFiles: [], catalog: stopAudioCatalog };

    const saved = await api('/api/stops/audio', {
      method: 'PUT',
      body: JSON.stringify({ stopAudio, mediaFiles }),
    });
    const merged = saved.stopAudio ?? { ...stopAudioCatalog, ...stopAudio };
    setStopAudioCatalog(merged);
    return { stopAudio, mediaFiles, catalog: merged };
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

      const audioResult = await uploadPendingVoiceFiles();

      const json = await api(`/api/routes/${encodeURIComponent(route.id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      if (andPush && pushToBus && targetBusIds.length) {
        const catalog = await getStopAudioCatalogForRoute(route, audioResult.catalog ?? stopAudioCatalog);
        if (Object.keys(catalog.stopAudio).length) {
          await fleetBroadcast({
            targetBusIds,
            commandType: 'MERGE_STATE',
            payload: { stopAudio: catalog.stopAudio, mediaFiles: catalog.mediaFiles },
          });
        }
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

      setRoute(attachSavedAudio(json.route, audioResult.catalog ?? stopAudioCatalog));
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
    if (isAssigned(route.id)) {
      setStatus(`Already assigned to ${selectedBusId} (${route.id}).`);
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
      setStatus(`Route ${route.id} assigned & queued for ${selectedBusId}`);
      await refreshAssigned();
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

  function savedAudioForStop(stop) {
    return audioFileForStop(stop, stopAudioCatalog);
  }

  function isStopUploading(stop) {
    const key = stop.en?.trim()?.toLowerCase();
    return key && uploadingStopKey === key;
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
                {routeSelectLabel(r)}
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
        Pick an MP3/MPEG file per stop — it uploads and saves immediately. After refresh you will see{' '}
        <strong>Saved: filename</strong> (the file picker always looks empty; that is normal).
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
              {routeSelectLabel(r)}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Route ID</label>
        <input value={route.id} readOnly className="route-id-readonly" title="Unique id — duplicate names and endpoints are allowed" />
      </div>
      <div className="form-group">
        <label>Route name</label>
        <input value={route.name} onChange={(e) => setRoute({ ...route, name: e.target.value })} />
      </div>
      <h3>Start stop</h3>
      <StopRow
        stop={route.startStop}
        savedAudioFile={savedAudioForStop(route.startStop)}
        uploading={isStopUploading(route.startStop)}
        onUploadFile={(file) => handleStopAudioUpload(route.startStop, file, (s) => setRoute({ ...route, startStop: s }))}
        onChange={(s) => setRoute({ ...route, startStop: s })}
      />
      <h3>Middle stops</h3>
      {route.stops.map((s, i) => (
        <StopRow
          key={i}
          stop={s}
          savedAudioFile={savedAudioForStop(s)}
          uploading={isStopUploading(s)}
          showRemove
          onUploadFile={(file) =>
            handleStopAudioUpload(s, file, (updated) => {
              const stops = [...route.stops];
              stops[i] = updated;
              setRoute({ ...route, stops });
            })
          }
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
      <StopRow
        stop={route.endStop}
        savedAudioFile={savedAudioForStop(route.endStop)}
        uploading={isStopUploading(route.endStop)}
        onUploadFile={(file) => handleStopAudioUpload(route.endStop, file, (s) => setRoute({ ...route, endStop: s }))}
        onChange={(s) => setRoute({ ...route, endStop: s })}
      />
      <div className="editor-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveRoute(false)}>
          Save catalog
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => saveRoute(true)}>
          Push route to bus
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || isAssigned(route.id)} onClick={assignRoute}>
          {isAssigned(route.id) ? '✓ Already assigned' : 'Assign & activate'}
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

function getStopAudioCatalogForRoute(route, catalog = {}) {
  const stopAudio = {};
  const mediaFiles = [];
  for (const s of [route.startStop, ...route.stops, route.endStop]) {
    const key = s?.en?.trim()?.toLowerCase();
    if (!key) continue;
    const entry = catalog[key];
    if (entry) {
      stopAudio[key] = entry;
      const file = entry.en?.audioFile;
      if (file) mediaFiles.push(file);
    }
  }
  return { stopAudio, mediaFiles };
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
