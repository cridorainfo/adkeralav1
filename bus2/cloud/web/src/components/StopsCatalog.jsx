import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
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
  const { selectedBusId, pushToBus } = useSelectedBus();
  const [stops, setStops] = useState([]);
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

  useEffect(() => {
    load().catch((err) => setError(err.message ?? 'Could not load stops'));
  }, [load]);

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

  async function saveStop(patch) {
    if (!selectedEn) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const body = { ...patch };
      if (pushOnSave && pushToBus && selectedBusId) {
        body.targetBusIds = [selectedBusId];
      }
      await api(`/api/stops/${encodeURIComponent(selectedEn)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMessage(`Saved "${selectedEn}" to all routes`);
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

  async function handleSaveGpsToStop() {
    if (!gpsPreview && edit.lat && edit.lng) {
      await saveStop({
        lat: Number(edit.lat),
        lng: Number(edit.lng),
        radiusM: Number(edit.radiusM) || 80,
      });
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
    });
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
            <p className="hint">{stops.length} stop{stops.length === 1 ? '' : 's'}</p>
            <div className="stops-list">
              {stops.map((s) => {
                const gps = formatGps(s);
                const missing = s.missing ?? getStopMissingTags(s);
                return (
                  <button
                    key={s.en}
                    type="button"
                    className={`stops-list-item${selectedEn === s.en ? ' selected' : ''}`}
                    onClick={() => selectStop(s.en)}
                  >
                    <div className="stops-list-item-main">
                      <strong>{s.en}</strong>
                      {s.ml ? <span className="stops-list-ml">{s.ml}</span> : null}
                    </div>
                    <div className="stops-list-item-meta">
                      <span>{gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : 'No GPS'}</span>
                      <span>{s.routes?.length ?? 0} route(s)</span>
                    </div>
                    <MissingBadges missing={missing} />
                  </button>
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
              GPS
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleSaveGpsToStop}
              disabled={busy}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
