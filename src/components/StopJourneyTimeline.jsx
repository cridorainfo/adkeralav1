import { getStopEn } from '../store/busStore';
import { BilingualStop } from './BilingualStop';

const MAX_VISIBLE = 10;
/** How many passed stops stay visible when the route is truncated. */
const COMPLETED_IN_VIEW = 3;

function stopRole(index, total) {
  if (index === 0) return 'start';
  if (index === total - 1) return 'end';
  return 'middle';
}

function getNextIndex(currentIndex, total, routeDirection) {
  if (routeDirection === 'reverse') {
    return currentIndex - 1 >= 0 ? currentIndex - 1 : null;
  }
  return currentIndex + 1 < total ? currentIndex + 1 : null;
}

function stopStatus(index, currentIndex, nextIndex, routeDirection) {
  if (nextIndex !== null && index === nextIndex) return 'next';

  if (routeDirection === 'reverse') {
    if (index >= currentIndex) return 'completed';
    return 'upcoming';
  }

  if (index <= currentIndex) return 'completed';
  return 'upcoming';
}

export function getMetroWindow(total, currentIndex, nextIndex, routeDirection) {
  if (total <= MAX_VISIBLE) {
    return { start: 0, end: total, hiddenBefore: 0, hiddenAfter: 0, truncated: false };
  }

  let start;
  let end;

  if (routeDirection === 'reverse') {
    if (nextIndex === null) {
      start = Math.max(0, total - MAX_VISIBLE);
      end = total;
    } else {
      // Keep next + upcoming on the left, plus a few passed stops on the right.
      start = Math.max(0, nextIndex - (MAX_VISIBLE - COMPLETED_IN_VIEW - 1));
      end = Math.min(total, start + MAX_VISIBLE);
      if (end - start < MAX_VISIBLE && start > 0) {
        start = Math.max(0, end - MAX_VISIBLE);
      }
    }
  } else if (nextIndex === null) {
    start = Math.max(0, total - MAX_VISIBLE);
    end = total;
  } else {
    // Keep a few completed stops before next, then next + upcoming.
    start = Math.max(0, nextIndex - COMPLETED_IN_VIEW);
    end = Math.min(total, start + MAX_VISIBLE);
    if (end - start < MAX_VISIBLE && start > 0) {
      start = Math.max(0, end - MAX_VISIBLE);
    }
  }

  return {
    start,
    end,
    hiddenBefore: start,
    hiddenAfter: total - end,
    truncated: true,
  };
}

function windowPercent(index, windowStart, windowEnd) {
  const span = windowEnd - windowStart - 1;
  if (span <= 0) return 0;
  return ((index - windowStart) / span) * 100;
}

function StopDot({ status, routeDirection }) {
  if (status === 'completed') {
    return (
      <span className="metro-line__dot metro-line__dot--done" aria-hidden="true">
        <span className="metro-line__check">✓</span>
      </span>
    );
  }

  if (status === 'next') {
    return (
      <span className="metro-line__dot metro-line__dot--next" aria-hidden="true">
        <span className="metro-line__dot-ring" />
        <span
          className={`metro-line__dot-arrow metro-line__dot-arrow--${routeDirection === 'reverse' ? 'reverse' : 'forward'}`}
        >
          ▶
        </span>
      </span>
    );
  }

  return <span className="metro-line__dot metro-line__dot--upcoming" aria-hidden="true" />;
}

export default function StopJourneyTimeline({ stopInfo }) {
  const stops = stopInfo.allStops ?? [];
  if (stops.length === 0) return null;

  const routeDirection = stopInfo.routeDirection ?? 'forward';
  const total = stops.length;
  const currentIndex = stopInfo.index ?? (routeDirection === 'reverse' ? total : -1);
  const nextIndex =
    stopInfo.upcomingIndex ??
    (routeDirection === 'reverse'
      ? currentIndex - 1 >= 0
        ? currentIndex - 1
        : null
      : currentIndex + 1 < total
        ? currentIndex + 1
        : null);

  const window = getMetroWindow(total, currentIndex, nextIndex, routeDirection);
  const visibleStops = stops.slice(window.start, window.end);
  const visibleCount = visibleStops.length;

  let fillPercent = 0;
  if (visibleCount > 1) {
    const fillIndex =
      currentIndex >= window.start && currentIndex < window.end ? currentIndex : null;
    if (fillIndex !== null) {
      fillPercent = windowPercent(fillIndex, window.start, window.end);
    }
  }

  const nextInWindow =
    nextIndex !== null && nextIndex >= window.start && nextIndex < window.end;

  let flowStart = 0;
  let flowWidth = 0;
  if (nextInWindow && visibleCount > 1) {
    const nextPos = windowPercent(nextIndex, window.start, window.end);
    flowStart = Math.min(fillPercent, nextPos);
    flowWidth = Math.abs(nextPos - fillPercent);
  }

  return (
    <section
      className={[
        'metro-line',
        routeDirection === 'reverse' && 'metro-line--reverse',
        window.truncated && 'metro-line--truncated',
        `metro-line--count-${Math.min(visibleCount, MAX_VISIBLE)}`,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Route stops"
    >
      <p className="metro-line__caption">
        <span>
          {Math.max(0, currentIndex + 1)} / {total}
        </span>
        {window.truncated && window.hiddenBefore > 0 && (
          <span className="metro-line__caption-muted">+{window.hiddenBefore} passed</span>
        )}
        {window.truncated && window.hiddenAfter > 0 && (
          <span className="metro-line__caption-muted">+{window.hiddenAfter} ahead</span>
        )}
      </p>

      <div className="metro-line__board" key={`${window.start}-${window.end}`}>
        {window.hiddenBefore > 0 && (
          <span className="metro-line__edge metro-line__edge--past" aria-hidden="true">
            ···
          </span>
        )}

        <div className="metro-line__track" style={{ '--metro-stops': visibleCount }}>
          <div className="metro-line__rail" aria-hidden="true">
            <div className="metro-line__rail-bg" />
            {fillPercent > 0 && (
              <div className="metro-line__rail-done" style={{ width: `${fillPercent}%` }} />
            )}
            {flowWidth > 0.5 && (
              <div
                className="metro-line__rail-flow"
                style={{ left: `${flowStart}%`, width: `${flowWidth}%` }}
              />
            )}
          </div>

          <ol className="metro-line__stops">
            {visibleStops.map((stop, vi) => {
              const i = window.start + vi;
              const status = stopStatus(i, currentIndex, nextIndex, routeDirection);

              return (
                <li
                  key={`${i}-${getStopEn(stop)}`}
                  className={[
                    'metro-line__stop',
                    `metro-line__stop--${status}`,
                    `metro-line__stop--${stopRole(i, total)}`,
                  ].join(' ')}
                >
                  <div className="metro-line__dot-lane">
                    <StopDot
                      key={`${i}-${status}`}
                      status={status}
                      routeDirection={routeDirection}
                    />
                  </div>
                  <BilingualStop
                    stop={stop}
                    size="xs"
                    mode="alternate"
                    className="metro-line__name"
                  />
                </li>
              );
            })}
          </ol>
        </div>

        {window.hiddenAfter > 0 && (
          <span className="metro-line__edge metro-line__edge--ahead" aria-hidden="true">
            ···
          </span>
        )}
      </div>
    </section>
  );
}
