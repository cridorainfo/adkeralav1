import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { isBusOnline } from './FleetMap.jsx';
import { isPlausibleMapCoord } from '../lib/mapCoords.js';

function stopLine(stop) {
  if (!stop?.en) return '—';
  return stop.ml ? `${stop.en} / ${stop.ml}` : stop.en;
}

function agoText(at) {
  if (!at) return null;
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  return `${mins}m ago`;
}

export default function FleetBusDetail({ busId, buses }) {
  const [telemetryData, setTelemetryData] = useState(null);
  const [routesData, setRoutesData] = useState(null);
  const [actionMessage, setActionMessage] = useState('');
  const [removingRouteId, setRemovingRouteId] = useState(null);

  const busRow = (buses ?? []).find((b) => b.busId === busId);
  const online = busRow ? isBusOnline(busRow.updatedAt) : Boolean(telemetryData?.online);

  const refresh = useCallback(async () => {
    if (!busId) return;
    try {
      const [tel, routes] = await Promise.all([
        api(`/api/buses/${encodeURIComponent(busId)}/telemetry`),
        api(`/api/buses/${encodeURIComponent(busId)}/routes`),
      ]);
      setTelemetryData(tel);
      setRoutesData(routes);
    } catch {
      setTelemetryData(null);
      setRoutesData(null);
    }
  }, [busId]);

  useEffect(() => {
    if (!busId) {
      setTelemetryData(null);
      setRoutesData(null);
      setActionMessage('');
      return undefined;
    }
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [busId, refresh]);

  async function removeAssignedRoute(routeId, routeName) {
    if (
      !window.confirm(
        `Remove "${routeName}" from this bus?\n\nThe route stays in the catalog. The bus drops it on next sync (~5s when online).`
      )
    ) {
      return;
    }
    setActionMessage('');
    setRemovingRouteId(routeId);
    try {
      await api(
        `/api/buses/${encodeURIComponent(busId)}/assigned-routes/${encodeURIComponent(routeId)}`,
        { method: 'DELETE' }
      );
      setActionMessage(`Removed "${routeName}" from fleet assignment.`);
      await refresh();
    } catch (err) {
      setActionMessage(err.message ?? 'Could not remove route');
    } finally {
      setRemovingRouteId(null);
    }
  }

  if (!busId) return null;

  const telemetry = telemetryData?.telemetry ?? {};
  const snapshot = telemetryData?.displaySnapshot ?? {};
  const view = snapshot.displayView ?? telemetry.displayView ?? 'route';
  const activeRoute = routesData?.activeRoute ?? null;
  const trip = routesData?.trip ?? {};
  const assignedRoutes = routesData?.routes ?? [];

  const routeName =
    activeRoute?.name ?? snapshot.routeName ?? telemetry.routeName ?? '—';
  const currentStop = telemetry.currentStopEn ?? '—';
  const nextStop = telemetry.nextStopEn ?? '—';
  const tripLabel = trip.tripStarted
    ? trip.tripEnded
      ? 'Trip ended'
      : 'In progress'
    : 'Not started';

  const driverLocation = telemetry.driverLocation ?? null;
  const hasFix = driverLocation?.lat != null && driverLocation?.lng != null && !driverLocation?.error;
  const onMap = hasFix && isPlausibleMapCoord(driverLocation.lat, driverLocation.lng);

  return (
    <div className="fleet-bus-detail">
      <h3>Live bus</h3>
      <p className="hint">
        <span className={`status-dot ${online ? 'online' : 'offline'}`} />
        {online ? 'Online' : 'Offline'}
        {telemetryData?.updatedAt
          ? ` · updated ${new Date(telemetryData.updatedAt).toLocaleTimeString()}`
          : ''}
      </p>

      <h4 className="fleet-section-title">Driver GPS</h4>
      {!driverLocation ? (
        <p className="hint">No GPS received from a driver phone yet.</p>
      ) : driverLocation.error ? (
        <p className="hint">Last report: {driverLocation.error}</p>
      ) : (
        <>
          <p className="hint">
            {driverLocation.lat.toFixed(5)}, {driverLocation.lng.toFixed(5)}
            {driverLocation.accuracy != null ? ` · ±${Math.round(driverLocation.accuracy)}m` : ''}
            {driverLocation.at ? ` · ${agoText(driverLocation.at)}` : ''}
            {driverLocation.source === 'phone' ? ' · via driver phone' : ''}
          </p>
          {!onMap && (
            <p className="hint">
              This fix looks invalid (null-island or out-of-range) — received and stored, just not
              drawn on the Live map below.
            </p>
          )}
        </>
      )}

      <div className="display-mirror fleet-bus-mirror">
        <div className="fleet-bus-mirror-label">
          {view === 'ad' ? '📢 Advertisement on display' : '🚌 Route on passenger screen'}
        </div>
        <h4>{routeName}</h4>
        <p>
          Current: <strong>{currentStop}</strong>
        </p>
        <p className="next">
          Next: <strong>{nextStop}</strong>
        </p>
        <p className="hint">
          Trip: {tripLabel}
          {trip.routeDirection ? ` · ${trip.routeDirection}` : ''}
        </p>
      </div>

      <h4 className="fleet-section-title">Assigned routes</h4>
      {actionMessage && <p className="hint">{actionMessage}</p>}
      {!assignedRoutes.length ? (
        <p className="hint">No routes assigned from the dashboard yet. Use Routes or Route catalog to assign.</p>
      ) : (
        <ul className="fleet-route-list">
          {assignedRoutes.map((route) => {
            const active = route.id === routesData?.activeRouteId;
            return (
              <li key={route.id} className={`fleet-route-item${active ? ' active' : ''}`}>
                <div className="fleet-route-item-head">
                  <div>
                    <strong>{route.name}</strong>
                    {active && <span className="fleet-route-badge">Active</span>}
                    <small className="route-id-inline">
                      <code>{route.id}</code>
                    </small>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm fleet-route-remove"
                    disabled={removingRouteId === route.id}
                    onClick={() => removeAssignedRoute(route.id, route.name)}
                  >
                    {removingRouteId === route.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
                <small>
                  {stopLine(route.startStop)} → {stopLine(route.endStop)}
                  {' · '}
                  {(route.stops?.length ?? 0) + 2} stops
                </small>
              </li>
            );
          })}
        </ul>
      )}

      {activeRoute && (
        <>
          <h4 className="fleet-section-title">Active route details</h4>
          <ul className="fleet-stop-list">
            <li>
              <span className="fleet-stop-role">Start</span> {stopLine(activeRoute.startStop)}
            </li>
            {(activeRoute.stops ?? []).map((stop) => (
              <li key={`${stop.en}-${stop.lat}`}>
                <span className="fleet-stop-role">Via</span> {stopLine(stop)}
              </li>
            ))}
            <li>
              <span className="fleet-stop-role">End</span> {stopLine(activeRoute.endStop)}
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
