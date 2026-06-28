import { useEffect, useRef, useState } from 'react';
import { adHasPlayableMedia } from '../lib/adPlayback';

export default function BannerAdStrip({ bannerAds, settings }) {
  const [index, setIndex] = useState(0);
  const videoRef = useRef(null);

  const enabled = settings?.enabled !== false;
  const ads = (bannerAds ?? []).filter(adHasPlayableMedia);
  const current = ads.length ? ads[index % ads.length] : null;
  const durationSec = current?.durationSec ?? settings?.defaultDurationSec ?? 8;
  const isVideo = current?.type === 'video';

  useEffect(() => {
    setIndex(0);
  }, [ads.length]);

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

  return (
    <aside className="display-banner-ad" aria-label="Banner advertisement">
      <div className="display-banner-ad-media">
        {isVideo ? (
          <video ref={videoRef} src={current.mediaUrl} playsInline muted />
        ) : (
          <img src={current.mediaUrl} alt="" onError={() => setIndex((i) => (i + 1) % ads.length)} />
        )}
      </div>
    </aside>
  );
}
