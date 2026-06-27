import { useState } from 'react';
import { getAllStops, getStopEn } from '../store/busStore';

export default function RouteManager({
  routes = [],
  activeRouteId,
  onAddRoute,
  onSelectRoute,
  onDeleteRoute,
  onAddStop,
  onUpdateStopMalayalam,
  onRemoveStop,
  onReorderMiddleStop,
}) {
  const [routeName, setRouteName] = useState('');
  const [startStop, setStartStop] = useState('');
  const [startStopMl, setStartStopMl] = useState('');
  const [endStop, setEndStop] = useState('');
  const [endStopMl, setEndStopMl] = useState('');
  const [newStop, setNewStop] = useState('');
  const [newStopMl, setNewStopMl] = useState('');

  const activeRoute = routes.find((r) => r.id === activeRouteId);
  const allStops = activeRoute ? getAllStops(activeRoute) : [];
  const middleCount = activeRoute?.stops?.length ?? 0;

  const handleCreate = (e) => {
    e.preventDefault();
    if (!routeName.trim() || !startStop.trim() || !endStop.trim()) return;
    onAddRoute(routeName.trim(), startStop.trim(), endStop.trim(), startStopMl, endStopMl);
    setRouteName('');
    setStartStop('');
    setStartStopMl('');
    setEndStop('');
    setEndStopMl('');
  };

  const handleAddStop = (e) => {
    e.preventDefault();
    if (!newStop.trim() || !activeRouteId) return;
    const added = onAddStop(activeRouteId, newStop.trim(), newStopMl);
    if (added === false) {
      alert('That stop is already on this route.');
      return;
    }
    setNewStop('');
    setNewStopMl('');
  };

  const malayalamTarget = (i, isStart, isEnd) => {
    if (isStart) return 'start';
    if (isEnd) return 'end';
    return i - 1;
  };

  return (
    <>
      <div className="panel">
        <h3 className="panel-title">🗺️ Create Route</h3>
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
            <div className="form-group">
              <label>Starting Stop (English)</label>
              <input
                value={startStop}
                onChange={(e) => setStartStop(e.target.value)}
                placeholder="e.g. Ernakulam KSRTC"
              />
            </div>
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
            <div className="form-group">
              <label>Final Stop (English)</label>
              <input
                value={endStop}
                onChange={(e) => setEndStop(e.target.value)}
                placeholder="e.g. Munnar Town"
              />
            </div>
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
      </div>

      {routes.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">📋 Routes</h3>
          <ul className="route-list">
            {routes.map((route) => {
              const stopCount = getAllStops(route).length;
              return (
                <li
                  key={route.id}
                  className={`route-item ${route.id === activeRouteId ? 'active' : ''}`}
                  onClick={() => onSelectRoute(route.id)}
                >
                  <div className="route-item-info">
                    <strong>{route.name}</strong>
                    <small>{stopCount} stop{stopCount === 1 ? '' : 's'}</small>
                  </div>
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
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {activeRoute && (
        <div className="panel">
          <h3 className="panel-title">🚏 Stops — {activeRoute.name}</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--kerala-muted)', marginBottom: '1rem' }}>
            {allStops.length} stops · English + Malayalam · reorder with ↑ ↓
          </p>

          <ul className="stops-list stops-list-unified">
            {allStops.map((stop, i) => {
              const isStart = i === 0;
              const isEnd = i === allStops.length - 1;
              const isMiddle = !isStart && !isEnd;
              const middleIndex = i - 1;
              const target = malayalamTarget(i, isStart, isEnd);

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
              <div className="form-group">
                <label>Add Stop (English)</label>
                <input
                  value={newStop}
                  onChange={(e) => setNewStop(e.target.value)}
                  placeholder="e.g. Aluva, Adimali..."
                />
              </div>
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
            <button type="submit" className="btn btn-ghost">
              + Add Stop
            </button>
          </form>
        </div>
      )}
    </>
  );
}
