import { useEffect, useRef, useState } from 'react';
import { getStopInfo, sameStop, getUpcomingPassengerStop, findStopByEn } from '../store/busStore';
import StopJourneyTimeline from '../components/StopJourneyTimeline';
import BannerAdStrip from '../components/BannerAdStrip';
import { BilingualStop, LanguageAlternateProvider } from '../components/BilingualStop';
import { useBusStore } from '../hooks/useBusStore';
import { APP_NAME, APP_DISPLAY_TAGLINE } from '../lib/brand';

export default function DisplayScreen({ embedded = false, passengerMode = false }) {
  const { state, endAd, playAdNow } = useBusStore();
  const s = state;
  const [adTimer, setAdTimer] = useState(0);
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const stateRef = useRef(s);
  stateRef.current = s;

  const stopInfo = getStopInfo(s);
  const ads = s.ads ?? [];
  const upcomingStop = getUpcomingPassengerStop(s);
  const announcedStop = s.announcementRequest?.stopEn
    ? findStopByEn(stopInfo.allStops, s.announcementRequest.stopEn)
    : null;
  const nextStopDisplay = announcedStop ?? upcomingStop;
  const currentAd = ads[s.currentAdIndex] ?? null;
  const adDuration = currentAd?.durationSec ?? s.adSettings?.defaultDurationSec ?? 12;
  const showingAd = s.displayView === 'ad' && currentAd;
  const isVideoAd = showingAd && currentAd?.type === 'video';
  const announcementPlaying = s.announcementStatus === 'playing';
  const isPassengerView =
    passengerMode ||
    (embedded ? Boolean(s.isFullscreen ?? s.appView === 'display') : s.appView === 'display');

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const clockTime = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
  const clockDate = now.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

  useEffect(() => {
    if (!showingAd) {
      setAdTimer(0);
      audioRef.current?.pause();
      return;
    }

    if (isVideoAd) return;

    setAdTimer(adDuration);
    const interval = setInterval(() => {
      setAdTimer((t) => {
        if (t <= 1) {
          endAd();
          return 0;
        }
        return t - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showingAd, isVideoAd, currentAd?.id, adDuration, endAd]);

  useEffect(() => {
    if (!showingAd || !isVideoAd) return;
    if (announcementPlaying) {
      videoRef.current?.pause();
      if (videoRef.current) videoRef.current.muted = true;
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    video.currentTime = 0;
    video.loop = false;

    const syncTimer = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setAdTimer(Math.max(0, Math.ceil(video.duration - video.currentTime)));
      }
    };

    let fallbackId = null;
    const onEnded = () => endAd();
    const onError = () => {
      fallbackId = setTimeout(() => endAd(), adDuration * 1000);
    };

    video.addEventListener('loadedmetadata', syncTimer);
    video.addEventListener('timeupdate', syncTimer);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    const shouldMute = Boolean(currentAd.audioUrl) || !(s.adSettings?.playAudio ?? true);
    video.muted = shouldMute;
    video.play().catch(() => {
      fallbackId = setTimeout(() => endAd(), adDuration * 1000);
    });

    return () => {
      if (fallbackId) clearTimeout(fallbackId);
      video.removeEventListener('loadedmetadata', syncTimer);
      video.removeEventListener('timeupdate', syncTimer);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.pause();
    };
  }, [showingAd, isVideoAd, currentAd?.id, currentAd?.audioUrl, adDuration, s.adSettings?.playAudio, announcementPlaying, endAd]);

  useEffect(() => {
    if (!showingAd || !(s.adSettings?.playAudio ?? true)) return;

    if (announcementPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.muted = true;
      }
      return;
    }

    if (currentAd?.audioUrl && audioRef.current) {
      audioRef.current.muted = false;
      audioRef.current.src = currentAd.audioUrl;
      audioRef.current.play().catch(() => {});
    }

    return () => {
      audioRef.current?.pause();
    };
  }, [showingAd, currentAd?.id, currentAd?.audioUrl, s.adSettings?.playAudio, announcementPlaying]);

  useEffect(() => {
    if (!(s.adSettings?.enabled ?? true) || !ads.length) return;

    const intervalSec = s.adSettings?.intervalSec ?? 90;
    const id = setInterval(() => {
      const latest = stateRef.current;
      const latestAds = latest.ads ?? [];
      if (!latest.adSettings?.enabled || !latestAds.length || latest.displayView === 'ad') return;

      const elapsed = (Date.now() - (latest.lastAdEndedAt ?? Date.now())) / 1000;
      if (elapsed >= intervalSec) playAdNow();
    }, 1000);

    return () => clearInterval(id);
  }, [s.adSettings?.enabled, s.adSettings?.intervalSec, ads.length, playAdNow]);

  return (
    <LanguageAlternateProvider intervalSec={s.displaySettings?.languageAlternateSec ?? 4}>
    <div className={`display-screen ${isPassengerView ? 'fullscreen' : ''}`}>
      <audio ref={audioRef} />

      <div className="display-top-bar">
        <div className="display-brand">
          <span className="display-brand-icon">🌴</span>
          <div className="display-brand-text">
            <h2>{APP_NAME}</h2>
            <span>{APP_DISPLAY_TAGLINE}</span>
          </div>
        </div>
        {stopInfo.routeName && (
          <div className="display-route-badge">{stopInfo.routeName}</div>
        )}
        <div className="display-top-bar-right">
          <div className="display-clock" aria-live="polite">
            <span className="display-clock-time">{clockTime}</span>
            <span className="display-clock-date">{clockDate}</span>
          </div>
        </div>
      </div>

      <main className="display-main">
        {showingAd ? (
          <div className="display-ad-view">
            <div className="display-ad-stage">
              <div className="display-ad-timer">{adTimer}s</div>
              <div className="display-ad-media">
                {currentAd.type === 'video' ? (
                  <video
                    ref={videoRef}
                    src={currentAd.mediaUrl}
                    playsInline
                    muted={Boolean(currentAd.audioUrl) || !(s.adSettings?.playAudio ?? true)}
                  />
                ) : (
                  <img src={currentAd.mediaUrl} alt="" />
                )}
              </div>
            </div>

            {showingAd && (nextStopDisplay || stopInfo.current) && (
              <section className="display-ad-stop-bar" aria-label="Next stop">
                <div className="display-ad-stop-bar-main">
                  <span className="display-ad-stop-bar-label">Next Stop</span>
                  <strong className="display-ad-stop-bar-name">
                    <BilingualStop
                      stop={nextStopDisplay ?? stopInfo.current}
                      size="sm"
                      mode="alternate"
                    />
                  </strong>
                </div>
                {stopInfo.final && !sameStop(stopInfo.final, nextStopDisplay) && (
                  <div className="display-ad-stop-bar-final">
                    <span>Final</span>
                    <strong>
                      <BilingualStop stop={stopInfo.final} size="sm" mode="alternate" />
                    </strong>
                  </div>
                )}
              </section>
            )}
          </div>
        ) : stopInfo.current ? (
          <div className="display-route-view">
            <div className="display-now-label">Next Stop</div>
            <BilingualStop
              stop={nextStopDisplay}
              size="hero"
              mode="alternate"
              className="display-current-stop"
              as="h1"
            />

            <div className="display-progress">
              <StopJourneyTimeline stopInfo={stopInfo} />
            </div>
          </div>
        ) : (
          <div className="no-route-msg">
            <span>🚌</span>
            Waiting for route…
            <br />
            <small>Set up a route on the Control panel (Ctrl+E)</small>
          </div>
        )}
      </main>

      {!showingAd && (
        <BannerAdStrip bannerAds={s.bannerAds} settings={s.bannerAdSettings} />
      )}

      {isPassengerView && (
        <p className="display-exit-hint" aria-hidden>
          Ctrl+E — control panel
        </p>
      )}
    </div>
    </LanguageAlternateProvider>
  );
}
