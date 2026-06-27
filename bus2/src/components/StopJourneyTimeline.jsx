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

function resolveCurrentIndex(stopInfo, total, routeDirection) {
  if (stopInfo.atTripStart) {
    return routeDirection === 'reverse' ? total : -1;
  }
  const idx = stopInfo.index;
  if (idx == null || idx < 0) {
    return routeDirection === 'reverse' ? total : -1;
  }
  return idx;
}

function visualSlot(index, windowStart, windowEnd, isReverse) {
  return isReverse ? windowEnd - 1 - index : index - windowStart;
}

function isBeforeNext(index, nextIndex, isReverse) {
  if (nextIndex === null) return false;
  return isReverse ? index > nextIndex : index < nextIndex;
}

function getLastCompletedIndex(currentIndex, nextIndex, total, isReverse) {
  if (nextIndex !== null) {
    const preceded = isReverse ? nextIndex + 1 : nextIndex - 1;
    if (preceded >= 0 && preceded < total) return preceded;
  }
  const departed = isReverse ? currentIndex < total : currentIndex >= 0;
  if (departed && currentIndex >= 0 && currentIndex < total) return currentIndex;
  return null;
}

function stopStatus(index, currentIndex, nextIndex, total, window, isReverse) {
  if (nextIndex !== null && index === nextIndex) return 'next';
  if (isBeforeNext(index, nextIndex, isReverse)) return 'completed';

  const departed = isReverse ? currentIndex < total : currentIndex >= 0;
  if (!departed) return 'upcoming';

  const slot = visualSlot(index, window.start, window.end, isReverse);
  const lastDoneSlot = visualSlot(currentIndex, window.start, window.end, isReverse);
  if (slot <= lastDoneSlot) return 'completed';
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

/** Map storage index to left→right track position (0–100). Reverse flips so left = trip origin. */
function trackPercent(index, windowStart, windowEnd, isReverse) {
  const span = windowEnd - windowStart - 1;
  if (span <= 0) return 0;
  const forwardPos = ((index - windowStart) / span) * 100;
  return isReverse ? 100 - forwardPos : forwardPos;
}

function segmentSizePercent(windowStart, windowEnd) {
  const span = windowEnd - windowStart - 1;
  return span > 0 ? 100 / span : 100;
}

function getRailSegments(currentIndex, nextIndex, window, total, isReverse) {
  const { start, end } = window;
  const visibleCount = end - start;
  const empty = { doneWidth: 0, flowStart: 0, flowWidth: 0 };

  if (visibleCount <= 1) return empty;

  const halfDot = segmentSizePercent(start, end) * 0.5;
  const lastCompleted = getLastCompletedIndex(currentIndex, nextIndex, total, isReverse);
  const lastInWindow = lastCompleted !== null && lastCompleted >= start && lastCompleted < end;
  const nextInWindow = nextIndex !== null && nextIndex >= start && nextIndex < end;

  const lastPos = lastInWindow ? trackPercent(lastCompleted, start, end, isReverse) : null;
  const nextPos = nextInWindow ? trackPercent(nextIndex, start, end, isReverse) : null;

  let doneWidth = 0;
  let flowStart = 0;
  let flowWidth = 0;

  if (lastInWindow) {
    doneWidth = Math.min(100, lastPos + halfDot * 0.3);
  }

  if (nextIndex === null) {
    const departed = isReverse ? currentIndex < total : currentIndex >= 0;
    return { doneWidth: departed ? 100 : doneWidth, flowStart: 0, flowWidth: 0 };
  }

  if (!nextInWindow) {
    return { doneWidth, flowStart: 0, flowWidth: 0 };
  }

  if (lastPos !== null) {
    const gapStart = Math.min(lastPos, nextPos);
    const gapEnd = Math.max(lastPos, nextPos);
    const gap = gapEnd - gapStart;
    const inset = Math.min(halfDot * 0.35, Math.max(gap * 0.1, 0.5));
    flowStart = gapStart + inset;
    const flowEnd = gapEnd - inset;
    flowWidth = Math.max(0.5, flowEnd - flowStart);
    doneWidth = Math.min(doneWidth, flowStart);
  } else {
    flowStart = 0;
    flowWidth = Math.max(0.5, nextPos - halfDot * 0.35);
  }

  return { doneWidth, flowStart, flowWidth };
}

function StopDot({ status }) {
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
        <span className="metro-line__dot-arrow">▶</span>
      </span>
    );
  }

  return <span className="metro-line__dot metro-line__dot--upcoming" aria-hidden="true" />;
}

export default function StopJourneyTimeline({ stopInfo }) {
  const stops = stopInfo.allStops ?? [];
  if (stops.length === 0) return null;

  const routeDirection = stopInfo.routeDirection ?? 'forward';
  const isReverse = routeDirection === 'reverse';
  const total = stops.length;
  const currentIndex = resolveCurrentIndex(stopInfo, total, routeDirection);
  const nextIndex =
    stopInfo.upcomingIndex ??
    getNextIndex(
      stopInfo.atTripStart ? (isReverse ? total - 1 : -1) : currentIndex,
      total,
      routeDirection
    );

  const window = getMetroWindow(total, currentIndex, nextIndex, routeDirection);
  const visibleSlice = stops.slice(window.start, window.end);

  // Always keep real storage indices; reverse only the left→right display order.
  const forwardEntries = visibleSlice.map((stop, vi) => ({
    stop,
    i: window.start + vi,
  }));
  const displayEntries = isReverse ? [...forwardEntries].reverse() : forwardEntries;

  const visibleCount = displayEntries.length;
  const rail = getRailSegments(currentIndex, nextIndex, window, total, isReverse);

  const passedCount = isReverse
    ? Math.max(0, total - (currentIndex >= total ? total : currentIndex + 1))
    : Math.max(0, currentIndex + 1);

  return (
    <section
      className={[
        'metro-line',
        isReverse && 'metro-line--reverse',
        window.truncated && 'metro-line--truncated',
        `metro-line--count-${Math.min(visibleCount, MAX_VISIBLE)}`,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Route stops"
    >
      <p className="metro-line__caption">
        <span className="metro-line__direction" aria-hidden="true">
          →
        </span>
        <span>
          {Math.min(passedCount, total)} / {total}
        </span>
        {window.truncated && window.hiddenBefore > 0 && (
          <span className="metro-line__caption-muted">
            {isReverse ? `+${window.hiddenBefore} ahead` : `+${window.hiddenBefore} passed`}
          </span>
        )}
        {window.truncated && window.hiddenAfter > 0 && (
          <span className="metro-line__caption-muted">
            {isReverse ? `+${window.hiddenAfter} passed` : `+${window.hiddenAfter} ahead`}
          </span>
        )}
      </p>

      <div className="metro-line__board" key={`${window.start}-${window.end}-${routeDirection}`}>
        {window.hiddenBefore > 0 && (
          <span
            className={`metro-line__edge metro-line__edge--${isReverse ? 'ahead' : 'past'}`}
            aria-hidden="true"
          >
            ···
          </span>
        )}

        <div className="metro-line__track" style={{ '--metro-stops': visibleCount }}>
          <div className="metro-line__rail" aria-hidden="true">
            <div className="metro-line__rail-bg" />
            {rail.doneWidth > 0 && (
              <div
                className="metro-line__rail-done"
                style={{ left: 0, width: `${rail.doneWidth}%` }}
              />
            )}
            {rail.flowWidth > 0.5 && (
              <div
                className="metro-line__rail-flow"
                style={{ left: `${rail.flowStart}%`, width: `${rail.flowWidth}%` }}
              />
            )}
          </div>

          <ol className="metro-line__stops">
            {displayEntries.map(({ stop, i }) => {
              const status = stopStatus(i, currentIndex, nextIndex, total, window, isReverse);

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
                    <StopDot status={status} />
                  </div>
                  <BilingualStop
                    stop={stop}
                    size="sm"
                    mode="alternate"
                    className="metro-line__name"
                  />
                </li>
              );
            })}
          </ol>
        </div>

        {window.hiddenAfter > 0 && (
          <span
            className={`metro-line__edge metro-line__edge--${isReverse ? 'past' : 'ahead'}`}
            aria-hidden="true"
          >
            ···
          </span>
        )}
      </div>
    </section>
  );
}
