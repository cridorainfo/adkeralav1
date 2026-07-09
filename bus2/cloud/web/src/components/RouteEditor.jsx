import { useCallback, useEffect, useState } from 'react';
import { api, uploadMedia, fleetBroadcast } from '../lib/api.js';
import { basename, pushAudioMergeToBuses } from '../lib/audioCatalogPush.js';
import { useSelectedBus } from './BusContext.jsx';
import { useBusAssignedRoutes } from '../hooks/useBusAssignedRoutes.js';
import { createRouteId, routeSelectLabel } from '../lib/routeLabels.js';
import { attachCatalogGpsToRoute } from '../lib/stopCatalog.js';

const AUDIO_ACCEPT = 'audio/*,.mp3,.mpeg,.mpga,audio/mpeg';
const emptyStop = () => ({ en: '', ml: '', lat: '', lng: '', radiusM: 80 });

/** Reusing an existing catalog stop should overwrite ml/lat/lng/radius with its
 * canonical values (that's the point — one shared source of truth instead of every
 * route re-entering the same stop slightly differently). Free typing never does this. */
function applyCatalogStopSelection(stop, hit) {
  return {
    ...stop,
    en: hit.en ?? stop.en,
    ml: hit.ml ?? stop.ml,
    lat: hit.lat ?? stop.lat,
    lng: hit.lng ?? stop.lng,
    radiusM: hit.radiusM ?? stop.radiusM,
  };
}

/** Type-to-search over the shared stop catalog (same list StopsCatalog.jsx manages) so
 * admins can reuse an already-complete stop (name, Malayalam, GPS) instead of retyping
 * it — many routes share the same stops. Selecting a match calls onSelectCatalogStop;
 * plain typing (no selection) only ever updates the English name via onChangeText. */
function StopNameField({ value, catalog, onChangeText, onSelectCatalogStop }) {
  const [open, setOpen] = useState(false);
  const query = String(value ?? '').trim().toLowerCase();

  const matches = query
    ? catalog
        .filter(
          (s) => s.en?.toLowerCase().includes(query) || s.ml?.toLowerCase().includes(query)
        )
        .slice(0, 8)
    : [];

  return (
    <div className="stop-name-field">
      <input
        placeholder="English (type to search existing stops)"
        value={value ?? ''}
        onChange={(e) => {
          onChangeText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <ul className="stop-name-suggestions">
          {matches.map((hit) => (
            <li
              key={hit.en}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectCatalogStop(hit);
                setOpen(false);
              }}
            >
              <strong>{hit.en}</strong>
              {hit.ml ? <span className="hint"> · {hit.ml}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StopRow({
  stop,
  catalog,
  onChange,
  onRemove,
  showRemove,
  savedAudioFile,
  onUploadFile,
  onDeleteAudio,
  uploading,
}) {
  return (
    <div className="stop-row">
      <StopNameField
        value={stop.en}
        catalog={catalog}
        onChangeText={(text) => onChange({ ...stop, en: text })}
        onSelectCatalogStop={(hit) => onChange(applyCatalogStopSelection(stop, hit))}
      />
      <input
        placeholder="Malayalam"
        value={stop.ml ?? ''}
        onChange={(e) => onChange({ ...stop, ml: e.target.value })}
      />
      <input
        placeholder="Lat"
        value={stop.lat ?? ''}
        onChange={(e) => onChange({ ...stop, lat: e.target.value })}
      />
      <input
        placeholder="Lng"
        value={stop.lng ?? ''}
        onChange={(e) => onChange({ ...stop, lng: e.target.value })}
      />
      <input
        placeholder="Radius"
        value={stop.radiusM ?? ''}
        onChange={(e) => onChange({ ...stop, radiusM: e.target.value })}
      />
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
        {savedAudioFile && onDeleteAudio ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={uploading}
            onClick={onDeleteAudio}
          >
            Remove audio
          </button>
        ) : null}
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
  const [stopGpsCatalog, setStopGpsCatalog] = useState([]);
  const [uploadingStopKey, setUploadingStopKey] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadStopCatalog = useCallback(async () => {
    try {
      const json = await api('/api/stops');
      setStopGpsCatalog(json.stops ?? []);
    } catch {
      setStopGpsCatalog([]);
    }
  }, []);

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
    loadStopCatalog();
  }, [loadRoutes, loadStopAudio, loadStopCatalog]);

  useEffect(() => {
    setRoute((prev) => {
      if (!prev) return null;
      return attachSavedAudio(attachCatalogGpsToRoute(prev, stopGpsCatalog), stopAudioCatalog);
    });
  }, [stopAudioCatalog, stopGpsCatalog]);

  const withCatalogData = useCallback(
    (r) => attachSavedAudio(attachCatalogGpsToRoute(r, stopGpsCatalog), stopAudioCatalog),
    [stopAudioCatalog, stopGpsCatalog]
  );

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
      const merged = saved.stopAudio ?? stopAudioCatalog;
      setStopAudioCatalog(merged);
      setStatus(`Audio saved for "${stopEn}"`);
      if (pushToBus && targetBusIds.length) {
        await pushAudioMergeToBuses({
          targetBusIds,
          stopAudio,
          mediaFiles: [relPath],
          removedMediaFiles: saved.removedFiles ?? [],
        });
      }
      return relPath;
    } finally {
      setUploadingStopKey(null);
    }
  }, [stopAudioCatalog, pushToBus, targetBusIds]);

  const deleteStopAudioEntry = useCallback(async (stopEn, applyStop, stop) => {
    const key = String(stopEn ?? '').trim().toLowerCase();
    if (!key) throw new Error('Enter the English stop name before removing audio.');
    const current = stopAudioCatalog[key]?.en?.audioFile;
    if (!current) return;
    if (!confirm(`Remove voice audio for "${stopEn}"?`)) return;
    setUploadingStopKey(key);
    setError('');
    try {
      const stopAudio = { [key]: { en: { audioFile: null } } };
      const saved = await api('/api/stops/audio', {
        method: 'PUT',
        body: JSON.stringify({ stopAudio }),
      });
      setStopAudioCatalog(saved.stopAudio ?? {});
      applyStop({ ...stop, _savedAudioFile: null, audioEn: null, _voiceFile: null });
      setStatus(`Audio removed for "${stopEn}"`);
      if (pushToBus && targetBusIds.length) {
        await pushAudioMergeToBuses({
          targetBusIds,
          stopAudio,
          removedMediaFiles: saved.removedFiles ?? [current],
        });
      }
    } catch (err) {
      setError(err.message ?? 'Could not remove audio');
      setStatus('');
    } finally {
      setUploadingStopKey(null);
    }
  }, [stopAudioCatalog, pushToBus, targetBusIds]);

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
      setRoute(withCatalogData(JSON.parse(JSON.stringify(found))));
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
      const mergedRoute = withCatalogData(route);
      const payload = {
        ...mergedRoute,
        name: route.name.trim(),
        startStop: normalizeStop(mergedRoute.startStop),
        endStop: normalizeStop(mergedRoute.endStop),
        stops: mergedRoute.stops.map(normalizeStop),
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

      setRoute(withCatalogData(json.route));
      setStatus(
        andPush && pushToBus && targetBusIds.length
          ? `Saved · pushed to ${targetBusIds.join(', ')}`
          : 'Saved to catalog'
      );
      await loadRoutes();
      await loadStopCatalog();
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
      setStatus(`Route ${route.id} assigned & pushed to ${selectedBusId}`);
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
        catalog={stopGpsCatalog}
        savedAudioFile={savedAudioForStop(route.startStop)}
        uploading={isStopUploading(route.startStop)}
        onUploadFile={(file) => handleStopAudioUpload(route.startStop, file, (s) => setRoute({ ...route, startStop: s }))}
        onDeleteAudio={() =>
          deleteStopAudioEntry(route.startStop.en, (s) => setRoute({ ...route, startStop: s }), route.startStop)
        }
        onChange={(s) => setRoute({ ...route, startStop: s })}
      />
      <h3>Middle stops</h3>
      {route.stops.map((s, i) => (
        <StopRow
          key={i}
          stop={s}
          catalog={stopGpsCatalog}
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
          onDeleteAudio={() =>
            deleteStopAudioEntry(s.en, (updated) => {
              const stops = [...route.stops];
              stops[i] = updated;
              setRoute({ ...route, stops });
            }, s)
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
        catalog={stopGpsCatalog}
        savedAudioFile={savedAudioForStop(route.endStop)}
        uploading={isStopUploading(route.endStop)}
        onUploadFile={(file) => handleStopAudioUpload(route.endStop, file, (s) => setRoute({ ...route, endStop: s }))}
        onDeleteAudio={() =>
          deleteStopAudioEntry(route.endStop.en, (s) => setRoute({ ...route, endStop: s }), route.endStop)
        }
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
