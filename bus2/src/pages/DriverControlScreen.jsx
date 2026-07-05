import { useCallback, useState } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { refreshRemoteState } from '../hooks/useRemoteStateSync';
import {
  getStopInfo,
  getStopEn,
  sameStop,
  getUpcomingPassengerStop,
  getDriverVisibleRoutes,
  isPersistenceReady,
} from '../store/busStore';
import AdKeralaLogo from '../components/AdKeralaLogo';
import { APP_NAME } from '../lib/brand';
import { postDriveAction } from '#hub/drive';
import { BilingualStop } from '../components/BilingualStop';
import { canPlayAnnouncement } from '../lib/audioFragments';
import { useDriverControl } from '../components/DriverControlContext';
import ConsoleStatus from '../components/ConsoleStatus';

export default function DriverControlScreen({ serialRuntime = null }) {
  const { state, applyRemoteState } = useBusStore();
  const { disconnect, plate } = useDriverControl();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const hubStateReady = isPersistenceReady() && (state.savedAt ?? 0) > 0;
  const busRoutes = getDriverVisibleRoutes(state);
  const activeRouteId =
    busRoutes.some((r) => r.id === state.activeRouteId)
      ? state.activeRouteId
      : (busRoutes[0]?.id ?? null);
  const driverState = { ...state, routes: busRoutes, activeRouteId };
  const stopInfo = getStopInfo(driverState);
  const routeDir = state.routeDirection ?? 'forward';
  const tripStarted = Boolean(state.tripStarted);
  const tripEnded = Boolean(state.tripEnded);
  const atTripEnd = stopInfo.atTripEnd;
  const hasRoute = Boolean(activeRouteId && busRoutes.some((r) => r.id === activeRouteId));
  const canUndo = tripStarted && !tripEnded && Boolean(state.tripDeparted);
  const showStart = hasRoute && !tripStarted;
  const showEnd = hasRoute && tripStarted && atTripEnd && !tripEnded;
  const showForward = hasRoute && tripStarted && !atTripEnd && !tripEnded;
  const announceTarget = getUpcomingPassengerStop(state);
  const canAnnounce =
    hasRoute &&
    announceTarget &&
    canPlayAnnouncement(state, announceTarget) &&
    tripStarted &&
    !tripEnded;

  const runDrive = useCallback(
    async (action, payload = {}) => {
      if (busy) return;
      setBusy(true);
      setError('');
      try {
        const result = await postDriveAction(action, payload);
        if (result.changed !== false) {
          applyRemoteState(
            {
              ...state,
              activeRouteId: result.activeRouteId ?? state.activeRouteId,
              tripStarted: Boolean(result.tripStarted),
              tripEnded: Boolean(result.tripEnded),
              tripDeparted: Boolean(result.tripDeparted),
              currentStopIndex: result.currentStopIndex ?? state.currentStopIndex,
              driveRevision: result.driveRevision ?? state.driveRevision,
              routeDirection: result.routeDirection ?? state.routeDirection,
              savedAt: result.savedAt ?? state.savedAt,
            },
            { force: true }
          );
        }
        await refreshRemoteState(applyRemoteState, { force: true });
      } catch (err) {
        setError(
          err.code === 'NO_ROUTE'
            ? 'Route not on bus yet — wait a few seconds for fleet sync'
            : err.code === 'HUB_RECONNECTING' || err.code === 'HUB_BOOT' || err.code === 'HUB_LOCKED'
            ? 'Reconnecting to bus — stay on bus Wi‑Fi'
            : (err.message ?? 'Could not reach bus — stay on bus Wi‑Fi')
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, applyRemoteState, state]
  );

  const handleAnnounce = () => {
    if (!announceTarget) return;
    const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
    runDrive('announce', { stopEn: getStopEn(announceTarget), isTerminus });
  };

  return (
    <div className="screen-shell driver-minimal-shell">
      <header className="screen-header driver-minimal-header">
        <div className="screen-header-brand">
          <AdKeralaLogo size="sm" />
          <div>
            <h1>{APP_NAME}</h1>
            <small>{plate ? `Bus ${plate}` : 'Driver control'}</small>
          </div>
        </div>
        <ConsoleStatus serialRuntime={serialRuntime ?? state.serialRuntime} compact />
      </header>

      <div className="screen-body">
        {error && (
          <div className="storage-error-banner" role="alert">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        <div className="panel driver-panel driver-minimal-panel">
          {!hubStateReady ? (
            <p className="driver-connect-status">Loading live status from bus hub…</p>
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
                    <BilingualStop
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
                        {announceTarget ? (
                          <BilingualStop stop={announceTarget} size="sm" />
                        ) : (
                          '—'
                        )}
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
                Press <strong>Forward</strong> when the bus leaves each stop. Stay on the same Wi‑Fi as
                the bus PC.
              </p>
            </>
          )}

          <button
            type="button"
            className="btn secondary driver-minimal-disconnect"
            onClick={() => disconnect()}
          >
            Disconnect from this bus
          </button>
        </div>
      </div>
    </div>
  );
}
