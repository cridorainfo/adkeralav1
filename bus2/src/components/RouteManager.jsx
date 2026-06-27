import { useEffect, useState } from 'react';
import { getAllStops, getStopEn, normalizeStop } from '../store/busStore';
import { formatRouteEndpoints, isCloudRouteOnBus } from '../lib/routeMatch';
import { useRouteEndpointSuggestions } from '../hooks/useRouteEndpointSuggestions';
import { useStopSearch } from '../hooks/useStopSearch';
import SharedRouteRow from './SharedRouteRow';
import { RouteAudioBadge, StopAudioMark } from './RouteAudioBadge';
import StopSearchInput from './StopSearchInput';

function StopGpsButton({ hasGps, onSet }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm stop-gps-btn"
      disabled={!hasGps}
      title={hasGps ? 'Set GPS from current location' : 'GPS not available'}
      onClick={onSet}
    >
      📍 GPS
    </button>
  );
}

export default function RouteManager({
  routes = [],
  activeRouteId,
  driverLocation,
  stopCatalog = [],
  cloudEnabled = false,
  onAddRoute,
  onImportRoute,
  onSelectRoute,
  onDeleteRoute,
  onAddStop,
  onUpdateStopMalayalam,
  onRemoveStop,
  onReorderMiddleStop,
  onUpdateStopLocation,
  onPublishRoute,
  onMergeCatalog,
  onAssignSharedRoute,
  onRouteActivated,
  driverMode = false,
}) {
  const [routeName, setRouteName] = useState('');
  const [startStop, setStartStop] = useState('');
  const [startStopMl, setStartStopMl] = useState('');
  const [endStop, setEndStop] = useState('');
  const [endStopMl, setEndStopMl] = useState('');
  const [newStop, setNewStop] = useState('');
  const [newStopMl, setNewStopMl] = useState('');
  const [attachGpsToNew, setAttachGpsToNew] = useState(true);
  const [publishing, setPublishing] = useState(null);
  const [publishMsg, setPublishMsg] = useState(null);
  const [copyMsg, setCopyMsg] = useState(null);
  const [copyingId, setCopyingId] = useState(null);

  const {
    suggestions: stopSuggestions,
    loading: stopSearchLoading,
    activeField,
    setActiveField,
    scheduleSearch,
    clearSuggestions,
  } = useStopSearch(stopCatalog, onMergeCatalog);

  const { matches: routeSuggestions, loading: routeSuggestLoading, scheduleRefresh } =
    useRouteEndpointSuggestions(routes, cloudEnabled);

  useEffect(() => {
    scheduleRefresh(startStop, endStop);
  }, [startStop, endStop, scheduleRefresh]);

  const activeRoute = routes.find((r) => r.id === activeRouteId);
  const allStops = activeRoute ? getAllStops(activeRoute) : [];
  const middleCount = activeRoute?.stops?.length ?? 0;
  const hasGps = driverLocation?.lat != null && driverLocation?.lng != null && !driverLocation?.error;
  const isSharedReadOnly = Boolean(driverMode && activeRoute?.sharedFromCloud);
  const sharedStopsText = allStops.map(getStopEn).join(', ');

  const applySuggestion = (field, stop) => {
    const n = normalizeStop(stop);
    if (field === 'start') {
      setStartStop(n.en);
      setStartStopMl(n.ml ?? '');
    } else if (field === 'end') {
      setEndStop(n.en);
      setEndStopMl(n.ml ?? '');
    } else {
      setNewStop(n.en);
      setNewStopMl(n.ml ?? '');
    }
    clearSuggestions();
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!routeName.trim() || !startStop.trim() || !endStop.trim()) return;
    onAddRoute(routeName.trim(), startStop.trim(), endStop.trim(), startStopMl, endStopMl);
    setRouteName('');
    setStartStop('');
    setStartStopMl('');
    setEndStop('');
    setEndStopMl('');
    setCopyMsg(null);
    clearSuggestions();
    onRouteActivated?.();
  };

  const handleCopyRoute = async (hit) => {
    setCopyingId(hit.route.id);
    setCopyMsg(null);
    try {
      if (hit.source === 'cloud' && onAssignSharedRoute) {
        await onAssignSharedRoute(hit.route.id);
        setCopyMsg(`“${hit.route.name}” kept on this bus (${hit.stopCount} stops).`);
      } else if (onImportRoute) {
        onImportRoute(hit.route, { activate: true });
        setCopyMsg(`Copied “${hit.route.name}” with ${hit.stopCount} stops.`);
      }
      setRouteName('');
      setStartStop('');
      setStartStopMl('');
      setEndStop('');
      setEndStopMl('');
      onRouteActivated?.();
    } catch (err) {
      setCopyMsg(err.message || 'Could not save route on this bus');
    } finally {
      setCopyingId(null);
    }
  };

  const handleAddStop = (e) => {
    e.preventDefault();
    if (!newStop.trim() || !activeRouteId) return;

    const extra = {};
    if (attachGpsToNew && hasGps) {
      extra.lat = driverLocation.lat;
      extra.lng = driverLocation.lng;
      extra.radiusM = 80;
    }

    const added = onAddStop(activeRouteId, newStop.trim(), newStopMl, extra);
    if (added === false) {
      alert('That stop is already on this route.');
      return;
    }
    setNewStop('');
    setNewStopMl('');
    clearSuggestions();
  };

  const handlePublish = async (route) => {
    if (!onPublishRoute) return;
    setPublishing(route.id);
    setPublishMsg(null);
    try {
      await onPublishRoute(route);
      setPublishMsg(`“${route.name}” shared with all drivers.`);
    } catch (err) {
      setPublishMsg(err.message);
    } finally {
      setPublishing(null);
    }
  };

  const malayalamTarget = (i, isStart, isEnd) => {
    if (isStart) return 'start';
    if (isEnd) return 'end';
    return i - 1;
  };

  const gpsTarget = malayalamTarget;

  const setStopGps = (gpsT) => {
    if (!hasGps || !onUpdateStopLocation || !activeRouteId) return;
    onUpdateStopLocation(activeRouteId, gpsT, {
      lat: driverLocation.lat,
      lng: driverLocation.lng,
    });
  };

  const renderStopGpsRow = (stop, i) => {
    const isStart = i === 0;
    const isEnd = i === allStops.length - 1;
    const n = normalizeStop(stop);
    const hasCoords = n.lat != null && n.lng != null;
    const gpsT = gpsTarget(i, isStart, isEnd);

    return (
      <li key={`${i}-${getStopEn(stop)}`} className="stop-gps-row">
        <div className="stop-gps-row-main">
          <span className="stop-row-name">
            {isStart && '🟢 '}
            {isEnd && !isStart && '🔴 '}
            {!isStart && !isEnd && '🟡 '}
            {getStopEn(stop)}
            <StopAudioMark stop={stop} />
            {hasCoords && (
              <span className="stop-gps-badge" title={`${n.lat}, ${n.lng}`}>
                📍 {n.lat.toFixed(4)}, {n.lng.toFixed(4)}
              </span>
            )}
          </span>
          {stop.ml ? <small lang="ml">{stop.ml}</small> : null}
        </div>
        {onUpdateStopLocation && <StopGpsButton hasGps={hasGps} onSet={() => setStopGps(gpsT)} />}
      </li>
    );
  };

  return (
    <>
      <div className="panel">
        <h3 className="panel-title">
          {driverMode ? '🗺️ Routes — pick, create, or edit' : '🗺️ Create Route'}
        </h3>
        <p className="panel-hint">
          {driverMode
            ? 'Type stop names to search the library — pick a match or enter a new name. Set GPS on any stop anytime with 📍 GPS.'
            : 'Enter starting and final stops — matching routes from other drivers appear below so you can copy them instead of building from scratch.'}
        </p>
        <form onSubmit={handleCreate}>
          <div className="form-row">
            <div className="form-group">
              <label>Route Name</label>
              <input
                value={routeName}
                onChange={(e) => setRouteName(e.target.value)}
                placeholder="e.g. KSRTC Express"
              />
            </div>
          </div>
          <div className="form-row">
            <StopSearchInput
              id="route-start-stop"
              label="Starting Stop (English)"
              value={startStop}
              onValueChange={(v) => {
                setStartStop(v);
                scheduleSearch(v, 'start');
              }}
              suggestions={stopSuggestions}
              loading={stopSearchLoading}
              isOpen={activeField === 'start'}
              onFocus={() => setActiveField('start')}
              onPick={(stop) => applySuggestion('start', stop)}
            />
            <div className="form-group">
              <label>Starting Stop (Malayalam)</label>
              <input
                value={startStopMl}
                onChange={(e) => setStartStopMl(e.target.value)}
                placeholder="e.g. എറണാകുളം"
                lang="ml"
              />
            </div>
          </div>
          <div className="form-row">
            <StopSearchInput
              id="route-end-stop"
              label="Final Stop (English)"
              value={endStop}
              onValueChange={(v) => {
                setEndStop(v);
                scheduleSearch(v, 'end');
              }}
              suggestions={stopSuggestions}
              loading={stopSearchLoading}
              isOpen={activeField === 'end'}
              onFocus={() => setActiveField('end')}
              onPick={(stop) => applySuggestion('end', stop)}
            />
            <div className="form-group">
              <label>Final Stop (Malayalam)</label>
              <input
                value={endStopMl}
                onChange={(e) => setEndStopMl(e.target.value)}
                placeholder="e.g. മുന്നാർ"
                lang="ml"
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary">
            + Create Route
          </button>
        </form>

        {startStop.trim() && endStop.trim() && (
          <div className="route-endpoint-suggestions">
            <h4 className="route-suggest-title">
              Matching routes
              {routeSuggestLoading && <span className="route-suggest-loading"> · searching…</span>}
            </h4>
            {copyMsg && <p className="cloud-route-message">{copyMsg}</p>}
            {routeSuggestions.length === 0 && !routeSuggestLoading ? (
              <p className="panel-hint">
                No shared route found for {startStop.trim()} → {endStop.trim()}. Create a new one
                above, or adjust stop names.
              </p>
            ) : (
              <ul className="route-suggest-list shared-route-list">
                {routeSuggestions.map((hit) => {
                  const middle = hit.route.stops?.length ?? 0;
                  const subtitle = `${formatRouteEndpoints(hit.route)}${middle > 0 ? ` · ${middle} middle stop${middle === 1 ? '' : 's'}` : ''}${hit.direction === 'reverse' ? ' · reverse direction' : ''}${hit.source === 'local' ? ' · on this bus' : ' · shared'}`;

                  if (hit.source === 'cloud') {
                    return (
                      <SharedRouteRow
                        key={hit.route.id ?? hit.route.name}
                        route={hit.route}
                        subtitle={subtitle}
                        onAdd={() => handleCopyRoute(hit)}
                        adding={copyingId === hit.route.id}
                        addLabel="Add"
                        alreadyAdded={isCloudRouteOnBus(routes, hit.route)}
                      />
                    );
                  }

                  return (
                    <li key={hit.route.id ?? hit.route.name} className="route-suggest-item">
                      <div className="route-suggest-info">
                        <strong>
                          {hit.route.name}
                          <RouteAudioBadge route={hit.route} />
                        </strong>
                        <small>{subtitle}</small>
                      </div>
                      {onImportRoute && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={copyingId === hit.route.id}
                          onClick={() => handleCopyRoute(hit)}
                        >
                          {copyingId === hit.route.id ? 'Saving…' : 'Copy route'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {routes.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">
            {driverMode ? '📋 Routes on this bus' : '📋 Your routes'}
          </h3>
          {driverMode && (
            <p className="panel-hint">Tap a route to activate it on the Drive tab.</p>
          )}
          {publishMsg && <p className="cloud-route-message">{publishMsg}</p>}
          <ul className="route-list">
            {routes.map((route) => {
              const stopCount = getAllStops(route).length;
              const isShared = Boolean(route.sharedFromCloud);
              return (
                <li
                  key={route.id}
                  className={`route-item ${route.id === activeRouteId ? 'active' : ''}`}
                  onClick={() => onSelectRoute(route.id)}
                >
                  <div className="route-item-info">
                    <strong>
                      {route.name}
                      <RouteAudioBadge route={route} />
                    </strong>
                    <small>
                      {stopCount} stop{stopCount === 1 ? '' : 's'}
                      {driverMode && isShared ? ' · shared (read-only)' : ''}
                    </small>
                  </div>
                  <div className="route-item-actions">
                    {cloudEnabled && onPublishRoute && !isShared && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        disabled={publishing === route.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePublish(route);
                        }}
                      >
                        {publishing === route.id ? 'Sharing…' : '☁️ Share'}
                      </button>
                    )}
                    {!(driverMode && isShared) && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete route "${route.name}"?`)) onDeleteRoute(route.id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                    {driverMode && isShared && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Remove "${route.name}" from this bus?`)) onDeleteRoute(route.id);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {activeRoute && (
        <div className="panel">
          <h3 className="panel-title">🚏 Stops — {activeRoute.name}</h3>
          {isSharedReadOnly ? (
            <>
              <p className="panel-hint shared-route-readonly-hint">
                Shared route — stop names cannot be edited, but you can set GPS on any stop below.
              </p>
              <details className="shared-route-detail" open>
                <summary className="shared-route-detail-summary">Route details</summary>
                {sharedStopsText && <p className="shared-route-stops-text">{sharedStopsText}</p>}
              </details>
              <ul className="stop-gps-list">
                {allStops.map((stop, i) => renderStopGpsRow(stop, i))}
              </ul>
            </>
          ) : (
            <>
          <p style={{ fontSize: '0.82rem', color: 'var(--kerala-muted)', marginBottom: '1rem' }}>
            {allStops.length} stops · tap 📍 GPS to set location from where you are now
          </p>

          <ul className="stops-list stops-list-unified">
            {allStops.map((stop, i) => {
              const isStart = i === 0;
              const isEnd = i === allStops.length - 1;
              const isMiddle = !isStart && !isEnd;
              const middleIndex = i - 1;
              const target = malayalamTarget(i, isStart, isEnd);
              const gpsT = gpsTarget(i, isStart, isEnd);
              const n = normalizeStop(stop);
              const hasCoords = n.lat != null && n.lng != null;

              return (
                <li
                  key={`${i}-${getStopEn(stop)}`}
                  className={isMiddle ? 'stop-row-middle' : 'stop-row-endpoint'}
                >
                  <div className="stop-row-main">
                    <span className="stop-row-name">
                      {isStart && '🟢 '}
                      {isEnd && !isStart && '🔴 '}
                      {isMiddle && '🟡 '}
                      {getStopEn(stop)}
                      <StopAudioMark stop={stop} />
                      {hasCoords && (
                        <span className="stop-gps-badge" title={`${n.lat}, ${n.lng}`}>
                          📍
                        </span>
                      )}
                    </span>
                    <input
                      className="stop-row-ml-input"
                      type="text"
                      lang="ml"
                      value={stop.ml ?? ''}
                      placeholder="Malayalam name"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdateStopMalayalam(activeRouteId, target, e.target.value)
                      }
                    />
                        {onUpdateStopLocation && (
                          <StopGpsButton hasGps={hasGps} onSet={() => setStopGps(gpsT)} />
                        )}
                  </div>
                  {isStart && <span className="stop-row-tag">Start</span>}
                  {isEnd && <span className="stop-row-tag stop-row-tag-final">Final</span>}
                  {isMiddle && (
                    <span className="stop-row-actions">
                      <button
                        type="button"
                        className="stop-move-btn"
                        title="Move up"
                        disabled={middleIndex === 0}
                        onClick={() => onReorderMiddleStop(activeRouteId, middleIndex, 'up')}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="stop-move-btn"
                        title="Move down"
                        disabled={middleIndex === middleCount - 1}
                        onClick={() => onReorderMiddleStop(activeRouteId, middleIndex, 'down')}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="stop-remove-btn"
                        onClick={() => onRemoveStop(activeRouteId, middleIndex)}
                      >
                        remove
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

              <form onSubmit={handleAddStop} style={{ marginTop: '1rem' }}>
                <div className="form-row">
                  <StopSearchInput
                    id="route-new-stop"
                    label="Add Stop (English)"
                    value={newStop}
                    onValueChange={(v) => {
                      setNewStop(v);
                      scheduleSearch(v, 'new');
                    }}
                    suggestions={stopSuggestions}
                    loading={stopSearchLoading}
                    isOpen={activeField === 'new'}
                    onFocus={() => setActiveField('new')}
                    onPick={(stop) => applySuggestion('new', stop)}
                  />
                  <div className="form-group">
                    <label>Add Stop (Malayalam)</label>
                    <input
                      value={newStopMl}
                      onChange={(e) => setNewStopMl(e.target.value)}
                      placeholder="e.g. ആലuva, അടിമലി..."
                      lang="ml"
                    />
                  </div>
                </div>
                {hasGps && (
                  <label className="stop-add-gps-option">
                    <input
                      type="checkbox"
                      checked={attachGpsToNew}
                      onChange={(e) => setAttachGpsToNew(e.target.checked)}
                    />
                    Use my current GPS for this stop ({driverLocation.lat.toFixed(5)},{' '}
                    {driverLocation.lng.toFixed(5)})
                  </label>
                )}
                <button type="submit" className="btn btn-ghost">
                  + Add Stop
                </button>
                <p className="panel-hint" style={{ marginTop: '0.5rem' }}>
                  Pick a library match from the list, or submit your typed name as a new stop.
                </p>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
