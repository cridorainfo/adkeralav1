import { useEffect, useRef, useState } from 'react';
import { getStopInfo, sameStop, getUpcomingPassengerStop, findStopByEn } from '../store/busStore';
import StopJourneyTimeline from '../components/StopJourneyTimeline';
import BannerAdStrip from '../components/BannerAdStrip';
import DriverPairingBanner from '../components/DriverPairingBanner';
import { useShowDriverPairingQr } from '../hooks/useShowDriverPairingQr';
import { BilingualStop, LanguageAlternateProvider } from '../components/BilingualStop';
import { useBusStore } from '../hooks/useBusStore';
import AdKeralaLogo from '../components/AdKeralaLogo';
import DisplayStatusDots from '../components/DisplayStatusDots';
import { APP_NAME, APP_DISPLAY_TAGLINE } from '../lib/brand';
import { adHasPlayableMedia, getFullscreenAdSchedule, nextPlayableAdIndex } from '../lib/adPlayback';
import { mediaPathToUrl } from '../lib/fileStorage';

export default function DisplayScreen({ embedded = false, passengerMode = false }) {
  const { state, endAd, playAdNow, update } = useBusStore();
  const s = state;
  const [adTimer, setAdTimer] = useState(0);
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const stateRef = useRef(s);
  const adCountdownRef = useRef({ adKey: null, startedAt: 0 });
  stateRef.current = s;

  const stopInfo = getStopInfo(s);
  const hasRouteStops = (stopInfo.allStops?.length ?? 0) > 0;
  const tripStarted = Boolean(s.tripStarted);
  const tripEnded = Boolean(s.tripEnded);
  const showTripOnDisplay = tripStarted || tripEnded;
  const ads = s.ads ?? [];
  const upcomingStop = getUpcomingPassengerStop(s);
  const announcedStop = s.announcementRequest?.stopEn
    ? findStopByEn(stopInfo.allStops, s.announcementRequest.stopEn)
    : null;
  const nextStopDisplay = announcedStop ?? upcomingStop ?? stopInfo.next ?? stopInfo.start;
  const displayStop = stopInfo.atTripStart ? stopInfo.start : nextStopDisplay;
  const destinationStop = stopInfo.final ?? stopInfo.start;
  const currentAd = ads[s.currentAdIndex] ?? null;
  const currentAdMediaUrl =
    currentAd?.mediaUrl || mediaPathToUrl(currentAd?.mediaFile) || null;
  const adDuration = currentAd?.durationSec ?? s.adSettings?.defaultDurationSec ?? 12;
  const showingAd = s.displayView === 'ad' && currentAd && adHasPlayableMedia(currentAd);
  const adStartedAt = s.adStartedAt ?? null;
  const isVideoAd = showingAd && currentAd?.type === 'video';
  const announcementPlaying = s.announcementStatus === 'playing';
  const theme = s.displaySettings?.theme ?? {};
  const showClock = theme.showClock !== false;
  const showBannerStrip =
    theme.showBanner !== false && (s.bannerAdSettings?.enabled ?? true);
  const brandTitle = s.displaySettings?.brandTitle?.trim() || APP_NAME;
  const screenStyle = {
    ...(theme.primaryColor ? { '--display-primary': theme.primaryColor } : {}),
    ...(theme.backgroundColor ? { '--display-bg': theme.backgroundColor } : {}),
    ...(theme.fontScale && theme.fontScale !== 1
      ? { fontSize: `calc(1rem * ${theme.fontScale})` }
      : {}),
    ...(theme.primaryColor && theme.backgroundColor
      ? {
          background: `linear-gradient(160deg, ${theme.primaryColor} 0%, ${theme.backgroundColor} 100%)`,
        }
      : {}),
  };
  const isPassengerView =
    passengerMode ||
    (embedded ? Boolean(s.isFullscreen ?? s.appView === 'display') : s.appView === 'display');
  const showDriverQr = useShowDriverPairingQr(s);
  const driverConnected = !showDriverQr;

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
      adCountdownRef.current = { adKey: null, startedAt: 0 };
      setAdTimer(0);
      audioRef.current?.pause();
      return;
    }

    if (isVideoAd) return;

    const adKey = `${s.currentAdIndex ?? 0}:${currentAd?.id ?? 'ad'}`;
    if (adCountdownRef.current.adKey !== adKey) {
      adCountdownRef.current = {
        adKey,
        startedAt: adStartedAt && adStartedAt > 0 ? adStartedAt : Date.now(),
      };
    }

    const startedAt = adCountdownRef.current.startedAt;
    const endsAt = startedAt + adDuration * 1000;
    let ended = false;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setAdTimer(remaining);
      if (remaining <= 0 && !ended) {
        ended = true;
        endAd();
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [showingAd, isVideoAd, currentAd?.id, s.currentAdIndex, adDuration, endAd]);

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
    if (ads.length || s.displayView !== 'ad') return;
    endAd();
  }, [ads.length, s.displayView, endAd]);

  useEffect(() => {
    if (s.displayView !== 'ad' || !currentAd) return;
    if (adHasPlayableMedia(currentAd)) return;
    const next = nextPlayableAdIndex(ads, (s.currentAdIndex ?? 0) + 1);
    if (next < 0) {
      endAd();
      return;
    }
    update((prev) =>
      prev.displayView !== 'ad'
        ? prev
        : { ...prev, currentAdIndex: next, adStartedAt: Date.now() }
    );
  }, [s.displayView, currentAd, ads, s.currentAdIndex, endAd, update]);

  useEffect(() => {
    if (!(s.adSettings?.enabled ?? true) || !ads.some(adHasPlayableMedia)) return;

    const id = setInterval(() => {
      const latest = stateRef.current;
      const latestAds = latest.ads ?? [];
      if (!latest.adSettings?.enabled || !latestAds.length || latest.displayView === 'ad') return;

      const { ready } = getFullscreenAdSchedule(latest);
      if (ready) playAdNow();
    }, 1000);

    return () => clearInterval(id);
  }, [
    s.adSettings?.enabled,
    s.adSettings?.intervalSec,
    s.adSettings?.initialDelaySec,
    ads.length,
    playAdNow,
  ]);

  return (
    <LanguageAlternateProvider intervalSec={s.displaySettings?.languageAlternateSec ?? 4}>
    <div
      className={`display-screen ${isPassengerView ? 'fullscreen' : ''}`}
      style={screenStyle}
    >
      <audio ref={audioRef} />

      <div className="display-top-bar">
        <div className="display-brand">
          <div className="display-brand-logo-wrap">
            <AdKeralaLogo className="display-brand-icon" size="md" />
            <DisplayStatusDots />
          </div>
          <div className="display-brand-text">
            <h2>{brandTitle}</h2>
            <span>{APP_DISPLAY_TAGLINE}</span>
          </div>
        </div>
        <div className="display-top-bar-center">
          {stopInfo.routeName && (
            <div className="display-route-badge">{stopInfo.routeName}</div>
          )}
        </div>
        <div className="display-top-bar-right">
          {showClock && (
            <div className="display-clock" aria-live="polite">
              <span className="display-clock-time">{clockTime}</span>
              <span className="display-clock-date">{clockDate}</span>
            </div>
          )}
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
                    src={currentAdMediaUrl}
                    playsInline
                    muted={Boolean(currentAd.audioUrl) || !(s.adSettings?.playAudio ?? true)}
                    onError={() => endAd()}
                  />
                ) : (
                  <img src={currentAdMediaUrl} alt="" onError={() => endAd()} />
                )}
              </div>
            </div>

            {showingAd && showTripOnDisplay && (displayStop || stopInfo.current) && (
              <section
                className="display-ad-stop-bar"
                aria-label={tripEnded ? 'Destination reached' : stopInfo.atTripStart ? 'At origin' : 'Next stop'}
              >
                <div className="display-ad-stop-bar-main">
                  <span className="display-ad-stop-bar-label">
                    {tripEnded ? 'Destination reached' : stopInfo.atTripStart ? 'At origin' : 'Next Stop'}
                  </span>
                  <strong className="display-ad-stop-bar-name">
                    <BilingualStop
                      stop={tripEnded ? destinationStop : displayStop ?? stopInfo.current}
                      size="sm"
                      mode="alternate"
                    />
                  </strong>
                </div>
                {showTripOnDisplay &&
                  stopInfo.final &&
                  !tripEnded &&
                  !sameStop(stopInfo.final, displayStop) && (
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
        ) : hasRouteStops && tripEnded ? (
          <div className="display-route-view display-route-view--ended">
            <div className="display-hero-center">
              <div className="display-now-label display-now-label--destination">Destination reached</div>
              <BilingualStop
                stop={destinationStop}
                size="hero"
                mode="alternate"
                className="display-current-stop display-current-stop--destination"
                as="h1"
              />
            </div>
          </div>
        ) : hasRouteStops && showTripOnDisplay ? (
          <div className="display-route-view">
            {stopInfo.start && stopInfo.final && (
              <div className="display-route-endpoints">
                <BilingualStop stop={stopInfo.start} size="sm" mode="alternate" />
                <span aria-hidden>→</span>
                <strong>
                  <BilingualStop stop={stopInfo.final} size="sm" mode="alternate" />
                </strong>
              </div>
            )}

            <div className="display-hero-center">
              <div className="display-now-label">
                {stopInfo.atTripStart ? 'At origin' : 'Next Stop'}
              </div>
              <BilingualStop
                stop={displayStop}
                size="hero"
                mode="alternate"
                className="display-current-stop"
                as="h1"
              />
            </div>

            <div className="display-progress">
              <StopJourneyTimeline stopInfo={stopInfo} />
            </div>
          </div>
        ) : (
          <div className="display-idle-view">
            <p className="display-idle-hint">
              {hasRouteStops
                ? 'Press Start on the driver Control panel to begin the trip and show the origin.'
                : 'Select a route on the driver Control panel to show stops and journey progress.'}
            </p>
          </div>
        )}
      </main>

      {isPassengerView && showDriverQr && <DriverPairingBanner visible compact />}

      {!showingAd && driverConnected && showBannerStrip && (
        <BannerAdStrip bannerAds={s.bannerAds} settings={s.bannerAdSettings} />
      )}
    </div>
    </LanguageAlternateProvider>
  );
}
