import { useBusStore } from '../hooks/useBusStore';
import { getRouteAudioSummary, hasPhraseAudio, hasStopNameAudio } from '../lib/audioFragments';

export function RouteAudioBadge({ route, className = '' }) {
  const { state } = useBusStore();
  if (!route) return null;

  const { withStopNames, total, hasAudio, complete, phrasesReady } = getRouteAudioSummary(
    state,
    route
  );
  if (!hasAudio) return null;

  const title = complete
    ? 'Shared phrases and stop names ready for all stops'
    : phrasesReady
      ? `Shared phrases ready · stop names ${withStopNames}/${total}`
      : `Stop name audio for ${withStopNames} of ${total} stops`;

  return (
    <span
      className={`route-audio-badge ${complete ? 'route-audio-badge--complete' : 'route-audio-badge--partial'} ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      🔊
      {!complete && total > 0 && (
        <span className="route-audio-badge-count">{withStopNames}/{total}</span>
      )}
    </span>
  );
}

export function StopAudioMark({ stop, className = '' }) {
  const { state } = useBusStore();
  if (!stop || (!hasStopNameAudio(state, stop) && !hasPhraseAudio(state))) return null;

  const title = hasStopNameAudio(state, stop)
    ? 'Stop name audio available'
    : 'Shared announcement phrases available (stop name not recorded)';

  return (
    <span
      className={`stop-audio-mark ${className}`.trim()}
      title={title}
      aria-label={title}
    >
      🔊
    </span>
  );
}
