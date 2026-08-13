import { useEffect, useRef } from 'react';
import { mediaPathToUrl } from '../lib/fileStorage';

const DEFAULT_IMAGE_DURATION_SEC = 10;

/**
 * Entertainment-mode content view — replaces the route/idle view in DisplayScreen.jsx's <main>
 * for buses in entertainment mode (busProfile.mode === 'entertainment', or 'auto' while its
 * pushed schedule's own active window — src/lib/scheduleWindow.js — is currently in effect).
 * Renders whatever
 * schedule.items[schedule.currentIndex] currently is and advances on its own: video plays to
 * its natural end, an image holds for durationSec (or a sensible default if none was set).
 * Banner strip and the fullscreen-ad overlay are siblings in DisplayScreen.jsx, not this
 * component — they already render independently of route state, so nothing here needs to know
 * about ads at all.
 */
export default function SchedulePlayer({ schedule, onItemStart, onItemEnd }) {
  const items = schedule?.items ?? [];
  const currentIndex = schedule?.currentIndex ?? 0;
  const currentItem = items[currentIndex] ?? null;
  const videoRef = useRef(null);
  const imageTimerRef = useRef(null);
  const startedItemIdRef = useRef(null);

  // Kick off/continue playback whenever the current item changes (including on first mount,
  // when nothing has started yet) — mirrors DisplayScreen.jsx's ad-scheduling effect pattern.
  useEffect(() => {
    if (!currentItem) return;
    if (startedItemIdRef.current === currentItem.id) return;
    startedItemIdRef.current = currentItem.id;
    onItemStart?.(currentIndex);

    if (currentItem.kind !== 'video') {
      const durationMs = (currentItem.durationSec || DEFAULT_IMAGE_DURATION_SEC) * 1000;
      imageTimerRef.current = setTimeout(() => onItemEnd?.(), durationMs);
    }
    return () => {
      if (imageTimerRef.current) {
        clearTimeout(imageTimerRef.current);
        imageTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.id]);

  if (!items.length) {
    return (
      <div className="display-idle-view">
        <p className="display-idle-hint">No content assigned yet — add media to this bus's schedule.</p>
      </div>
    );
  }

  if (!currentItem) return null;

  const url = mediaPathToUrl(currentItem.mediaFile);

  return (
    <div className="display-schedule-view">
      {currentItem.kind === 'video' ? (
        // key={currentItem.id} forces a brand-new <video> element per playlist item instead of
        // reusing the same DOM node with a swapped `src` — without it, switching from item N to
        // item N+1 on the same element was unreliable (observed as the previous item appearing to
        // play again instead of advancing), the same class of bug the fullscreen ad player avoids
        // by unmounting/remounting its own <video> on every ad change.
        <video
          key={currentItem.id}
          ref={videoRef}
          src={url}
          autoPlay
          playsInline
          muted={false}
          onEnded={() => onItemEnd?.()}
          onError={() => onItemEnd?.()}
        />
      ) : (
        <img key={currentItem.id} src={url} alt="" />
      )}
    </div>
  );
}
