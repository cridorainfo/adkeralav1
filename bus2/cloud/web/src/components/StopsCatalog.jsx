import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, uploadMedia } from '../lib/api.js';
import { basename, pushAudioMergeToBuses } from '../lib/audioCatalogPush.js';
import { useSelectedBus } from './BusContext.jsx';
import {
  MISSING_LABELS,
  captureCurrentPosition,
  formatGps,
  getStopMissingTags,
} from '../lib/stopCompleteness.js';

const FILTER_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'gps_coords', label: 'Missing GPS' },
  { id: 'malayalam_text', label: 'Missing Malayalam' },
  { id: 'english_name', label: 'Missing English' },
];

const AUDIO_ACCEPT = 'audio/*,.mp3,.mpeg,.mpga,audio/mpeg';

function MissingBadges({ missing }) {
  if (!missing?.length) return <span className="stops-missing-ok">Complete</span>;
  return (
    <span className="stops-missing-badges">
      {missing.map((m) => (
        <span key={m} className="stops-missing-badge">
          {MISSING_LABELS[m] ?? m}
        </span>
      ))}
    </span>
  );
}

export default function StopsCatalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedBusId, pushToBus, targetBusIds } = useSelectedBus();
  const [stops, setStops] = useState([]);
  const [stopAudioCatalog, setStopAudioCatalog] = useState({});
  const [audioBusy, setAudioBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(searchParams.get('missing') || 'all');
  const [selectedEn, setSelectedEn] = useState(searchParams.get('highlight') || '');
  const [edit, setEdit] = useState({ ml: '', lat: '', lng: '', radiusM: 80 });
  const [pushOnSave, setPushOnSave] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [gpsPreview, setGpsPreview] = useState(null);
  const [gpsBusy, setGpsBusy] = useState(false);

  const selectedStop = useMemo(
    () => stops.find((s) => s.en === selectedEn) ?? null,
    [stops, selectedEn]
  );

  const load = useCallback(async () => {
    setError('');
    const params = new URLSearchParams({ view: 'all' });
    if (query.trim()) params.set('q', query.trim());
    if (filter && filter !== 'all') params.set('missing', filter);
    const json = await api(`/api/stops?${params}`);
    setStops(json.stops ?? []);
  }, [query, filter]);

  const loadStopAudio = useCallback(async () => {
    try {
      const json = await api('/api/stops/audio/catalog');
      setStopAudioCatalog(json.stopAudio ?? {});
    } catch {
      setStopAudioCatalog({});
    }
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message ?? 'Could not load stops'));
    loadStopAudio();
  }, [load, loadStopAudio]);

  useEffect(() => {
    const highlight = searchParams.get('highlight');
    const missing = searchParams.get('missing');
    if (missing) setFilter(missing);
    if (highlight) setSelectedEn(highlight);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedStop) {
      setEdit({ ml: '', lat: '', lng: '', radiusM: 80 });
      setGpsPreview(null);
      return;
    }
    setEdit({
      ml: selectedStop.ml ?? '',
      lat: selectedStop.lat != null ? String(selectedStop.lat) : '',
      lng: selectedStop.lng != null ? String(selectedStop.lng) : '',
      radiusM: selectedStop.radiusM ?? 80,
    });
    setGpsPreview(null);
  }, [selectedStop]);

  function selectStop(en) {
    setSelectedEn(en);
    setMessage('');
    setError('');
    const next = new URLSearchParams(searchParams);
    if (en) next.set('highlight', en);
    else next.delete('highlight');
    setSearchParams(next, { replace: true });
  }

  const selectedAudioFile = useMemo(() => {
    if (!selectedEn) return null;
    return stopAudioCatalog[selectedEn.trim().toLowerCase()]?.en?.audioFile ?? null;
  }, [selectedEn, stopAudioCatalog]);

  async function persistStopAudioPatch(stopEn, patch, mediaFiles = []) {
    setAudioBusy(true);
    setError('');
    try {
      const saved = await api('/api/stops/audio', {
        method: 'PUT',
        body: JSON.stringify({ stopAudio: patch, mediaFiles }),
      });
      setStopAudioCatalog(saved.stopAudio ?? {});
      if (pushOnSave && pushToBus && targetBusIds.length) {
        await pushAudioMergeToBuses({
          targetBusIds,
          stopAudio: patch,
          mediaFiles,
          removedMediaFiles: saved.removedFiles ?? [],
        });
      }
      return saved;
    } finally {
      setAudioBusy(false);
    }
  }

  async function handleStopAudioUpload(file) {
    if (!selectedEn || !file) return;
    const key = selectedEn.trim().toLowerCase();
    const up = await uploadMedia(file, 'stops');
    const relPath = up.path ?? up.audioFile;
    if (!relPath) throw new Error('Upload did not return a file path.');
    const patch = { [key]: { en: { audioFile: relPath } } };
    await persistStopAudioPatch(selectedEn, patch, [relPath]);
    setMessage(`Voice audio updated for "${selectedEn}"`);
  }

  async function handleStopAudioDelete() {
    if (!selectedEn || !selectedAudioFile) return;
    if (!confirm(`Remove voice audio for "${selectedEn}"?`)) return;
    const key = selectedEn.trim().toLowerCase();
    const patch = { [key]: { en: { audioFile: null } } };
    await persistStopAudioPatch(selectedEn, patch);
    setMessage(`Voice audio removed for "${selectedEn}"`);
  }

  async function saveStop(patch, stopEn = selectedEn) {
    if (!stopEn) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const body = { ...patch };
      if (pushOnSave && pushToBus && selectedBusId) {
        body.targetBusIds = [selectedBusId];
      }
      await api(`/api/stops/${encodeURIComponent(stopEn)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMessage(`Saved "${stopEn}" to all routes`);
      if (stopEn !== selectedEn) selectStop(stopEn);
      await load();
    } catch (err) {
      setError(err.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveForm(e) {
    e.preventDefault();
    await saveStop({
      ml: edit.ml,
      lat: edit.lat === '' ? null : Number(edit.lat),
      lng: edit.lng === '' ? null : Number(edit.lng),
      radiusM: Number(edit.radiusM) || 80,
    });
  }

  async function handleUseLocation() {
    setGpsBusy(true);
    setError('');
    try {
      const fix = await captureCurrentPosition();
      setGpsPreview(fix);
      setEdit((prev) => ({
        ...prev,
        lat: String(fix.lat),
        lng: String(fix.lng),
      }));
    } catch (err) {
      setError(err.message ?? 'Could not get GPS — allow location permission');
    } finally {
      setGpsBusy(false);
    }
  }

  async function handleSaveGpsToStop(stopEn = selectedEn) {
    if (!stopEn) return;
    if (!gpsPreview && edit.lat && edit.lng && stopEn === selectedEn) {
      await saveStop({
        lat: Number(edit.lat),
        lng: Number(edit.lng),
        radiusM: Number(edit.radiusM) || 80,
      }, stopEn);
      return;
    }
    if (!gpsPreview) {
      setError('Capture location first');
      return;
    }
    await saveStop({
      lat: gpsPreview.lat,
      lng: gpsPreview.lng,
      radiusM: Number(edit.radiusM) || 80,
    }, stopEn);
  }

  async function handleQuickMobileGps(stop) {
    setSelectedEn(stop.en);
    setMessage('');
    setError('');
    setGpsBusy(true);
    try {
      const fix = await captureCurrentPosition();
      setGpsPreview(fix);
      setEdit((prev) => ({
        ...prev,
        lat: String(fix.lat),
        lng: String(fix.lng),
      }));
      await saveStop({
        lat: fix.lat,
        lng: fix.lng,
        radiusM: Number(edit.radiusM) || 80,
      }, stop.en);
    } catch (err) {
      setError(err.message ?? 'Could not get GPS — allow location permission');
    } finally {
      setGpsBusy(false);
    }
  }

  return (
    <div className="stops-hub">
      <div className="card">
        <h2>Stops hub</h2>
        <p className="hint">
          All stops from every route. Edit names and GPS here — changes apply across all routes that use
          the same English name.
        </p>

        <div className="stops-filter-chips">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`btn btn-sm ${filter === chip.id ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="toolbar">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search English or Malayalam…"
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={() => load()}>
            Search
          </button>
        </div>

        {error && (
          <p className="hint" style={{ color: 'var(--kerala-coral)' }} role="alert">
            {error}
          </p>
        )}
        {message && <p className="hint">{message}</p>}

        <div className="stops-hub-layout">
          <div className="stops-list-panel">
            <p className="hint stops-mobile-list-hint">
              Tap a stop to edit. On phone, use <strong>📍 GPS here</strong> on each row or the bar at the bottom
              after selecting a stop.
            </p>
            <p className="hint">{stops.length} stop{stops.length === 1 ? '' : 's'}</p>
            <div className="stops-list">
              {stops.map((s) => {
                const gps = formatGps(s);
                const missing = s.missing ?? getStopMissingTags(s);
                return (
                  <div
                    key={s.en}
                    role="button"
                    tabIndex={0}
                    className={`stops-list-item${selectedEn === s.en ? ' selected' : ''}`}
                    onClick={() => selectStop(s.en)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectStop(s.en);
                      }
                    }}
                  >
                    <div className="stops-list-item-main">
                      <strong>{s.en}</strong>
                      {s.ml ? <span className="stops-list-ml">{s.ml}</span> : null}
                    </div>
                    <div className="stops-list-item-meta">
                      <span>{gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'No GPS'}</span>
                      <span>{s.routes?.length ?? 0} route(s)</span>
                    </div>
                    <div className="stops-list-item-footer">
                      <MissingBadges missing={missing} />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm stops-list-gps-btn"
                        disabled={gpsBusy || busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleQuickMobileGps(s);
                        }}
                      >
                        {gpsBusy && selectedEn === s.en
                          ? 'GPS…'
                          : gps
                            ? '📍 Update GPS'
                            : '📍 GPS here'}
                      </button>
                    </div>
                  </div>
                );
              })}
              {!stops.length && <p className="hint">No stops match this filter.</p>}
            </div>

            <table className="data-table stops-table-desktop">
              <thead>
                <tr>
                  <th>English</th>
                  <th>Malayalam</th>
                  <th>GPS</th>
                  <th>Routes</th>
                  <th>Missing</th>
                </tr>
              </thead>
              <tbody>
                {stops.map((s) => {
                  const gps = formatGps(s);
                  const missing = s.missing ?? getStopMissingTags(s);
                  return (
                    <tr
                      key={s.en}
                      className={selectedEn === s.en ? 'selected' : undefined}
                      onClick={() => selectStop(s.en)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{s.en}</td>
                      <td>{s.ml || '—'}</td>
                      <td>{gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : '—'}</td>
                      <td>
                        {(s.routes ?? [])
                          .map((r) => r.routeName)
                          .filter((n, i, a) => a.indexOf(n) === i)
                          .join(', ') || '—'}
                      </td>
                      <td>
                        <MissingBadges missing={missing} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={`stops-edit-panel${selectedStop ? ' open' : ''}`}>
            {selectedStop ? (
              <>
                <h3>{selectedStop.en}</h3>
                <p className="hint">
                  Used on:{' '}
                  {(selectedStop.routes ?? [])
                    .map((r) => r.routeName)
                    .filter((n, i, a) => a.indexOf(n) === i)
                    .join(' · ') || '—'}
                </p>

                <form onSubmit={handleSaveForm} className="stops-edit-form">
                  <div className="form-group">
                    <label>Malayalam name</label>
                    <input
                      value={edit.ml}
                      onChange={(e) => setEdit({ ...edit, ml: e.target.value })}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Latitude</label>
                      <input
                        value={edit.lat}
                        onChange={(e) => setEdit({ ...edit, lat: e.target.value })}
                        inputMode="decimal"
                      />
                    </div>
                    <div className="form-group">
                      <label>Longitude</label>
                      <input
                        value={edit.lng}
                        onChange={(e) => setEdit({ ...edit, lng: e.target.value })}
                        inputMode="decimal"
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Arrival radius (m)</label>
                    <input
                      type="number"
                      min={20}
                      max={500}
                      value={edit.radiusM}
                      onChange={(e) => setEdit({ ...edit, radiusM: e.target.value })}
                    />
                  </div>
                  <label className="stops-push-label">
                    <input
                      type="checkbox"
                      checked={pushOnSave}
                      onChange={(e) => setPushOnSave(e.target.checked)}
                    />
                    Push to selected bus after save
                  </label>
                  <button type="submit" className="btn btn-primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save stop'}
                  </button>
                </form>

                <div className="stops-audio-section">
                  <h4>Stop voice (English)</h4>
                  <p className="hint">One audio file per stop. Uploading replaces the previous clip.</p>
                  <p className="hint">
                    Current: {selectedAudioFile ? basename(selectedAudioFile) : 'No audio'}
                  </p>
                  <div className="toolbar">
                    <input
                      type="file"
                      accept={AUDIO_ACCEPT}
                      disabled={audioBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) {
                          handleStopAudioUpload(file).catch((err) =>
                            setError(err.message ?? 'Audio upload failed')
                          );
                        }
                      }}
                    />
                    {selectedAudioFile ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={audioBusy}
                        onClick={() =>
                          handleStopAudioDelete().catch((err) =>
                            setError(err.message ?? 'Could not remove audio')
                          )
                        }
                      >
                        Remove audio
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="stops-field-capture">
                  <h4>Field GPS capture</h4>
                  <p className="hint">Stand at the stop, then capture your phone GPS and save.</p>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleUseLocation}
                    disabled={gpsBusy}
                  >
                    {gpsBusy ? 'Getting location…' : 'Use my location'}
                  </button>
                  {gpsPreview && (
                    <div className="stops-gps-preview">
                      <div>
                        {gpsPreview.lat.toFixed(6)}, {gpsPreview.lng.toFixed(6)}
                      </div>
                      <small>Accuracy ±{Math.round(gpsPreview.accuracy)} m</small>
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSaveGpsToStop}
                    disabled={busy}
                  >
                    Save GPS to {selectedStop.en}
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">Select a stop to edit or capture GPS.</p>
            )}
          </div>
        </div>
      </div>

      {selectedStop && (
        <div className="stops-field-bar-mobile" aria-live="polite">
          <div className="stops-field-bar-mobile-info">
            <strong>{selectedStop.en}</strong>
            {gpsPreview && (
              <small>
                {gpsPreview.lat.toFixed(5)}, {gpsPreview.lng.toFixed(5)} (±{Math.round(gpsPreview.accuracy)}m)
              </small>
            )}
          </div>
          <div className="stops-field-bar-mobile-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleUseLocation}
              disabled={gpsBusy}
            >
              {gpsBusy ? 'Getting location…' : '📍 Capture GPS'}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => handleSaveGpsToStop()}
              disabled={busy || !gpsPreview}
            >
              Save GPS
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
