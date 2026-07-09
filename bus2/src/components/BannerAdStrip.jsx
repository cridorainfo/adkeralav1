import { useEffect, useRef, useState } from 'react';
import { adHasPlayableMedia } from '../lib/adPlayback';
import { mediaPathToUrl } from '../lib/fileStorage';

export default function BannerAdStrip({ bannerAds, settings, onAdEnd }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef(null);
  const adStartedAtRef = useRef(null);

  const enabled = settings?.enabled !== false;
  const ads = (bannerAds ?? []).filter(adHasPlayableMedia);
  const current = ads.length ? ads[index % ads.length] : null;
  const durationSec = current?.durationSec ?? settings?.defaultDurationSec ?? 8;
  const isVideo = current?.type === 'video';

  useEffect(() => {
    setIndex(0);
  }, [ads.length]);

  // Play tracking — this effect re-runs (and its cleanup fires) whenever the shown ad
  // changes, so the cleanup uniformly reports the *outgoing* ad's play whether it ended via
  // interval rotation, a video ended/error event, or the strip unmounting/losing its ads
  // (route change) — one chokepoint instead of instrumenting three separate exit points.
  useEffect(() => {
    if (!current?.id) return undefined;
    adStartedAtRef.current = Date.now();
    return () => {
      const playedAt = adStartedAtRef.current;
      if (!playedAt) return;
      const durationPlayedSec = Math.max(0, Math.round((Date.now() - playedAt) / 1000));
      const adDurationSec = Number(current.durationSec) || durationSec;
      onAdEnd?.(current, playedAt, durationPlayedSec, durationPlayedSec >= adDurationSec - 1);
    };
  }, [current?.id, onAdEnd]);

  useEffect(() => {
    if (!enabled || !ads.length || isVideo) return;

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % ads.length);
    }, durationSec * 1000);

    return () => clearInterval(id);
  }, [enabled, ads.length, index, durationSec, isVideo, current?.id]);

  useEffect(() => {
    if (!enabled || !isVideo || !videoRef.current) return;

    const video = videoRef.current;
    video.currentTime = 0;
    video.muted = true;
    video.loop = false;

    const onEnded = () => setIndex((i) => (i + 1) % ads.length);
    const onError = () => {
      setTimeout(() => setIndex((i) => (i + 1) % ads.length), durationSec * 1000);
    };

    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.play().catch(onError);

    return () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.pause();
    };
  }, [enabled, isVideo, current?.id, ads.length, durationSec]);

  if (!enabled || !current) return null;

  const mediaUrl = current.mediaUrl || mediaPathToUrl(current.mediaFile);

  return (
    <aside className="display-banner-ad" aria-label="Banner advertisement">
      <div className="display-banner-ad-media">
        {isVideo ? (
          <video ref={videoRef} src={mediaUrl} playsInline muted />
        ) : (
          <img src={mediaUrl} alt="" onError={() => setIndex((i) => (i + 1) % ads.length)} />
        )}
      </div>
    </aside>
  );
}
