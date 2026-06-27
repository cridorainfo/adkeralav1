import { getAllStops, getStopEn } from '../store/busStore';
import { RouteAudioBadge, StopAudioMark } from './RouteAudioBadge';

export default function SharedRouteRow({
  route,
  subtitle,
  onAdd,
  adding = false,
  addLabel = 'Add',
  alreadyAdded = false,
}) {
  const allStops = getAllStops(route);
  const stopsText = allStops.map(getStopEn).join(', ');

  return (
    <li className="shared-route-row">
      <div className="shared-route-row-main">
        <div className="shared-route-row-info">
          <strong>
            {route.name}
            <RouteAudioBadge route={route} />
          </strong>
          {subtitle && <small>{subtitle}</small>}
        </div>
        {alreadyAdded ? (
          <span className="shared-route-added-badge" aria-label="Already on this bus">
            Added
          </span>
        ) : (
          onAdd && (
            <button
              type="button"
              className="btn btn-primary btn-sm shared-route-add-btn"
              disabled={adding}
              onClick={onAdd}
            >
              {adding ? 'Adding…' : addLabel}
            </button>
          )
        )}
      </div>
      <details className="shared-route-detail">
        <summary className="shared-route-detail-summary">Route details</summary>
        {stopsText && <p className="shared-route-stops-text">{stopsText}</p>}
        {allStops.length > 0 && (
          <ol className="shared-route-stops-list">
            {allStops.map((stop, i) => (
              <li key={`${i}-${getStopEn(stop)}`}>
                {getStopEn(stop)}
                <StopAudioMark stop={stop} />
                {stop.ml ? <span lang="ml"> · {stop.ml}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </details>
    </li>
  );
}
