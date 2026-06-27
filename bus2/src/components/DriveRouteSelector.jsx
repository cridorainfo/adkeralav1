import { getAllStops, getStopEn } from '../store/busStore';
import { RouteAudioBadge } from './RouteAudioBadge';

export default function DriveRouteSelector({
  routes = [],
  activeRouteId,
  routeDirection = 'forward',
  tripInProgress = false,
  onSelectRoute,
  onSetRouteDirection,
}) {
  if (!routes.length) return null;

  return (
    <section className="drive-bus-routes" aria-label="Routes on this bus">
      <h4 className="drive-bus-routes-title">Routes on this bus</h4>
      <p className="drive-bus-routes-hint">
        Select a route and direction anytime. Changing route or direction resets the current trip
        so you can start again.
      </p>
      {tripInProgress && (
        <p className="drive-bus-routes-reset-note" role="status">
          Trip in progress — pick another route or direction to cancel and reconfigure.
        </p>
      )}
      <ul className="drive-bus-route-list">
        {routes.map((route) => {
          const stops = getAllStops(route);
          const origin = stops[0] ?? null;
          const terminus = stops[stops.length - 1] ?? null;
          const isActive = route.id === activeRouteId;

          return (
            <li
              key={route.id}
              className={`drive-bus-route-card ${isActive ? 'drive-bus-route-card--active' : ''}`}
            >
              <button
                type="button"
                className="drive-bus-route-select"
                aria-pressed={isActive}
                onClick={() => onSelectRoute(route.id)}
              >
                <span className="drive-bus-route-name">
                  {route.name}
                  <RouteAudioBadge route={route} />
                </span>
                {origin && terminus && (
                  <span className="drive-bus-route-endpoints">
                    {getStopEn(origin)} → {getStopEn(terminus)}
                  </span>
                )}
                <span className="drive-bus-route-meta">
                  {stops.length} stop{stops.length === 1 ? '' : 's'}
                  {route.sharedFromCloud ? ' · shared' : ''}
                </span>
              </button>

              {isActive && origin && terminus && (
                <div className="drive-bus-route-direction">
                  <span className="route-direction-label">Trip direction</span>
                  <div className="route-direction-options">
                    <button
                      type="button"
                      className={`btn route-direction-btn ${routeDirection === 'forward' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => onSetRouteDirection('forward')}
                    >
                      {getStopEn(origin)} → {getStopEn(terminus)}
                    </button>
                    <button
                      type="button"
                      className={`btn route-direction-btn ${routeDirection === 'reverse' ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => onSetRouteDirection('reverse')}
                    >
                      {getStopEn(terminus)} → {getStopEn(origin)}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
