import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME } from '../lib/brand.js';
import { useBusLanState } from '../hooks/useBusLanState.js';
import { postDriveAction } from '../lib/driverDriveApi.js';
import { disconnectFromBus, ensureDriverSession } from '../lib/driverConnectFlow.js';
import { loadBusControlUrl } from '../lib/driverLanStorage.js';
import {
  getDriverVisibleRoutes,
  getStopEn,
  getStopInfo,
  getUpcomingPassengerStop,
  sameStop,
} from '../lib/busTripControl.js';

function StopLabel({ stop, size = 'md' }) {
  if (!stop) return '—';
  const en = stop.en ?? '';
  const ml = stop.ml ?? '';
  const className = size === 'sm' ? 'driver-stop-sm' : 'driver-stop-md';
  return (
    <span className={className}>
      <strong>{en}</strong>
      {ml ? <span className="driver-stop-ml"> / {ml}</span> : null}
    </span>
  );
}

export default function DriverControl() {
  const navigate = useNavigate();
  const handleRevoked = useCallback(
    (message) => {
      navigate('/driver', { replace: true, state: { revoked: true, message } });
    },
    [navigate]
  );
  const { state, connected, plate, error, setError, refreshState, pingSession } = useBusLanState({
    onRevoked: handleRevoked,
  });
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (loadBusControlUrl()) return;
    navigate('/driver', { replace: true });
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await ensureDriverSession();
      if (cancelled) return;
      if (!result.ok && result.reason === 'need-code') {
        navigate('/driver', { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const s = state ?? {};
  const busRoutes = getDriverVisibleRoutes(s);
  const activeRouteId =
    busRoutes.some((r) => r.id === s.activeRouteId) ? s.activeRouteId : (busRoutes[0]?.id ?? null);
  const driverState = { ...s, routes: busRoutes, activeRouteId };
  const stopInfo = getStopInfo(driverState);
  const routeDir = s.routeDirection ?? 'forward';
  const tripStarted = Boolean(s.tripStarted);
  const tripEnded = Boolean(s.tripEnded);
  const atTripEnd = stopInfo.atTripEnd;
  const hasRoute = Boolean(activeRouteId && busRoutes.some((r) => r.id === activeRouteId));
  const canUndo = tripStarted && !tripEnded && Boolean(s.tripDeparted);
  const showStart = hasRoute && !tripStarted;
  const showEnd = hasRoute && tripStarted && atTripEnd && !tripEnded;
  const showForward = hasRoute && tripStarted && !atTripEnd && !tripEnded;
  const announceTarget = getUpcomingPassengerStop(s);
  const canAnnounce = hasRoute && announceTarget && tripStarted && !tripEnded;

  const runDrive = useCallback(
    async (action, payload = {}) => {
      if (busy) return;
      setBusy(true);
      setLocalError('');
      try {
        await postDriveAction(action, payload);
        await refreshState();
        await pingSession();
      } catch (err) {
        if (err.code === 'DRIVER_LOCKED') {
          navigate('/driver', { replace: true });
          return;
        }
        setLocalError(err.message ?? 'Could not reach bus — stay on bus Wi‑Fi');
      } finally {
        setBusy(false);
      }
    },
    [busy, navigate, pingSession, refreshState]
  );

  useEffect(() => {
    if (!busRoutes.length) return;
    const valid = busRoutes.some((r) => r.id === s.activeRouteId);
    if (!valid && busRoutes[0]?.id) {
      runDrive('selectRoute', { routeId: busRoutes[0].id });
    }
  }, [s.activeRouteId, busRoutes, runDrive]);

  const handleAnnounce = () => {
    if (!announceTarget) return;
    const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
    runDrive('announce', { stopEn: getStopEn(announceTarget), isTerminus });
  };

  const handleDisconnect = async () => {
    await disconnectFromBus();
    navigate('/driver', { replace: true });
  };

  const displayError = localError || error;

  return (
    <div className="driver-control-page driver-minimal-shell">
      <header className="driver-control-header driver-minimal-header">
        <div className="driver-control-brand">
          <AdKeralaLogo size="sm" />
          <div>
            <h1>{APP_NAME}</h1>
            <small>{plate ? `Bus ${plate}` : 'Driver control'}</small>
          </div>
        </div>
        <div className="driver-minimal-status" role="status">
          <span className={`driver-minimal-dot ${connected ? 'on' : 'off'}`} aria-hidden />
          {connected ? 'Connected' : 'Reconnecting…'}
        </div>
      </header>

      <div className="driver-control-body">
        {displayError && (
          <div className="driver-control-error" role="alert">
            <span>{displayError}</span>
            <button type="button" className="btn btn-ghost" onClick={() => { setLocalError(''); setError(''); }}>
              Dismiss
            </button>
          </div>
        )}

        <div className="panel driver-panel driver-minimal-panel">
          {!state ? (
            <p className="driver-connect-status">Loading bus state…</p>
          ) : !busRoutes.length ? (
            <div className="drive-no-route">
              <p>No routes on this bus yet.</p>
              <p className="drive-no-route-hint">
                Assign routes from the Fleet dashboard — they sync to the bus PC within a few seconds.
              </p>
            </div>
          ) : (
            <>
              <section className="driver-minimal-routes" aria-label="Route">
                <label className="driver-minimal-label" htmlFor="driver-route-select">
                  Route
                </label>
                <select
                  id="driver-route-select"
                  className="driver-minimal-select"
                  value={activeRouteId ?? ''}
                  disabled={busy}
                  onChange={(e) => runDrive('selectRoute', { routeId: e.target.value })}
                >
                  {busRoutes.map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.name}
                    </option>
                  ))}
                </select>
              </section>

              {hasRoute && (
                <section className="driver-minimal-direction" aria-label="Direction">
                  <span className="driver-minimal-label">Direction</span>
                  <div className="drive-mode-toggle" role="group">
                    <button
                      type="button"
                      className={routeDir === 'forward' ? 'active' : ''}
                      disabled={busy}
                      onClick={() => runDrive('setDirection', { direction: 'forward' })}
                    >
                      Forward →
                    </button>
                    <button
                      type="button"
                      className={routeDir === 'reverse' ? 'active' : ''}
                      disabled={busy}
                      onClick={() => runDrive('setDirection', { direction: 'reverse' })}
                    >
                      ← Reverse
                    </button>
                  </div>
                </section>
              )}

              {hasRoute && (
                <div className="stop-display-mini driver-minimal-stops">
                  <div className="current-label">
                    {!tripStarted
                      ? 'Ready — press Start'
                      : tripEnded
                        ? 'Trip complete'
                        : stopInfo.atTripStart
                          ? 'At origin'
                          : 'Last departed'}
                  </div>
                  <div className="current-stop">
                    <StopLabel
                      stop={
                        tripEnded
                          ? stopInfo.final
                          : !tripStarted || stopInfo.atTripStart
                            ? stopInfo.start
                            : stopInfo.current
                      }
                      size="sm"
                    />
                  </div>
                  <div className="stop-meta">
                    <div className="stop-meta-item">
                      <span>Next</span>
                      <strong>
                        {announceTarget ? <StopLabel stop={announceTarget} size="sm" /> : '—'}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              <div className="driver-buttons driver-minimal-buttons">
                {showStart && (
                  <button
                    type="button"
                    className="btn btn-lg btn-start"
                    disabled={busy}
                    onClick={() => runDrive('startTrip')}
                  >
                    Start ▶
                  </button>
                )}
                {showForward && (
                  <button
                    type="button"
                    className="btn btn-lg btn-forward"
                    disabled={busy}
                    onClick={() => runDrive('forward')}
                  >
                    Forward ▶
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-lg btn-reverse"
                  disabled={busy || !canUndo}
                  onClick={() => runDrive('undo')}
                >
                  ◀ Undo
                </button>
                <button
                  type="button"
                  className="btn btn-lg btn-announce"
                  disabled={busy || !canAnnounce}
                  onClick={handleAnnounce}
                >
                  🔊 Announce
                </button>
                {showEnd && (
                  <button
                    type="button"
                    className="btn btn-lg btn-end"
                    disabled={busy}
                    onClick={() => runDrive('endTrip')}
                  >
                    End ✓
                  </button>
                )}
              </div>

              <p className="driver-minimal-hint">
                Press <strong>Forward</strong> when the bus leaves each stop. Stay on the same Wi‑Fi as the bus PC.
              </p>
            </>
          )}

          <button type="button" className="btn secondary driver-minimal-disconnect" onClick={handleDisconnect}>
            Disconnect from this bus
          </button>
        </div>
      </div>
    </div>
  );
}
