import { useEffect, useState } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { getStopInfo, getStopEn, sameStop, getUpcomingPassengerStop } from '../store/busStore';
import { APP_NAME, APP_CONTROL_SUBTITLE } from '../lib/brand';
import RouteManager from '../components/RouteManager';
import AdManager from '../components/AdManager';
import AnnouncementManager from '../components/AnnouncementManager';
import SerialSettings from '../components/SerialSettings';
import { BilingualStop } from '../components/BilingualStop';
import CloudRoutePicker from '../components/CloudRoutePicker';
import { hasAnnouncementAudio } from '../lib/audioFragments';
import {
  findNearestStopOnRoute,
  findStopAtLocation,
  formatGpsAccuracy,
} from '../lib/geoUtils';

function secsUntilNextAd(state) {
  if (!state.adSettings?.enabled || !(state.ads?.length)) return null;
  const interval = state.adSettings?.intervalSec ?? 90;
  const elapsed = Math.floor((Date.now() - (state.lastAdEndedAt ?? Date.now())) / 1000);
  return Math.max(0, interval - elapsed);
}

export default function ControlScreen({
  serial,
  isSerialSupported = false,
  driverMode = false,
}) {
  const {
    state,
    storageError,
    clearStorageError,
    addRoute,
    deleteRoute,
    addStop,
    updateStopMalayalam,
    removeStop,
    reorderMiddleStop,
    selectRoute,
    moveForward,
    undoForward,
    setRouteDirection,
    addAd,
    addAds,
    removeAd,
    updateAd,
    addBannerAd,
    addBannerAds,
    removeBannerAd,
    updateBannerAd,
    playAdNow,
    endAd,
    updateSerialSettings,
    updateAdSettings,
    updateBannerAdSettings,
    updateDisplaySettings,
    updateAnnouncementSettings,
    updateAudioFragment,
    clearAudioFragment,
    updateStopAudioClip,
    clearStopAudioClip,
    requestAnnouncement,
  } = useBusStore();

  const [tab, setTab] = useState('drive');
  const [, tick] = useState(0);

  const serialSettings = state.serialSettings ?? {};
  const stopInfo = getStopInfo(state);
  const hasRoute = !!state.activeRouteId;
  const routeDir = state.routeDirection ?? 'forward';
  const atTripEnd = stopInfo.atTripEnd;
  const canUndo = !stopInfo.atTripStart;
  const canChangeDirection = stopInfo.atTripStart;
  const nextAdIn = secsUntilNextAd(state);
  const routeStops = stopInfo.allStops ?? [];
  const routeOrigin = routeStops[0] ?? null;
  const routeTerminus = routeStops[routeStops.length - 1] ?? null;
  const announceTarget = getUpcomingPassengerStop(state);
  const canAnnounce =
    hasRoute &&
    announceTarget &&
    (state.announcementSettings?.enabled ?? true) &&
    hasAnnouncementAudio(state, announceTarget);

  const displayLive = state.displayView === 'ad' || Boolean(state.tripDeparted);

  const gps = state.driverLocation;
  const nearestStop =
    gps?.lat != null && gps?.lng != null ? findNearestStopOnRoute(state, gps.lat, gps.lng) : null;
  const atStop =
    gps?.lat != null && gps?.lng != null ? findStopAtLocation(state, gps.lat, gps.lng) : null;

  const visibleTabs = driverMode
    ? ['drive', 'routes', 'settings']
    : ['drive', 'routes', 'ads', 'voice', 'settings'];

  const handleAnnounce = () => {
    if (!announceTarget) return;
    const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
    requestAnnouncement(announceTarget, { isTerminus });
  };

  const handleTestAnnouncement = (stop, isTerminus) => {
    requestAnnouncement(stop, { isTerminus });
  };

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tabs = driverMode
      ? ['drive', 'routes', 'settings']
      : ['drive', 'routes', 'ads', 'voice', 'settings'];
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, driverMode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  return (
    <div className="screen-shell">
      <header className="screen-header">
        <div className="screen-header-brand">
          <span>🌴</span>
          <div>
            <h1>{APP_NAME}</h1>
            <small>{APP_CONTROL_SUBTITLE}</small>
          </div>
        </div>
        <div className="screen-header-actions">
          <span
            className={`control-display-live ${displayLive ? 'on' : ''}`}
            title="Passenger display on bus screen"
          >
            <span className="control-display-live-dot" aria-hidden />
            Display {displayLive ? 'LIVE' : 'standby'}
          </span>
          {!driverMode && (
            <button type="button" className="btn btn-gold" onClick={playAdNow} disabled={!(state.ads?.length)}>
              ▶ Play Ad
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAnnounce}
            disabled={!canAnnounce}
            title="Play composed stop announcement on display"
          >
            🔊 Announce
          </button>
        </div>
      </header>

      <div className="screen-body">
        {storageError && (
          <div className="storage-error-banner" role="alert">
            <span>{storageError}</span>
            <button type="button" className="btn btn-ghost" onClick={clearStorageError}>
              Dismiss
            </button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {visibleTabs.includes('drive') && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'drive'}
            className={`tab ${tab === 'drive' ? 'active' : ''}`}
            onClick={() => setTab('drive')}
          >
            🚌 Drive
          </button>
          )}
          {visibleTabs.includes('routes') && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'routes'}
            className={`tab ${tab === 'routes' ? 'active' : ''}`}
            onClick={() => setTab('routes')}
          >
            🗺️ Routes
          </button>
          )}
          {visibleTabs.includes('ads') && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ads'}
            className={`tab ${tab === 'ads' ? 'active' : ''}`}
            onClick={() => setTab('ads')}
          >
            📢 Ads
          </button>
          )}
          {visibleTabs.includes('voice') && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'voice'}
            className={`tab ${tab === 'voice' ? 'active' : ''}`}
            onClick={() => setTab('voice')}
          >
            🔊 Voice
          </button>
          )}
          {visibleTabs.includes('settings') && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'settings'}
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            ⚙️ Settings
          </button>
          )}
        </div>

        <div className="tab-panels" role="tabpanel">
        {tab === 'drive' && (
          <div className="panel driver-panel" style={{ maxWidth: 560, margin: '0 auto' }}>
            <h3 className="panel-title">🎮 Driver Controls</h3>

            {isSerialSupported && serialSettings.enabled && serial && (
              <SerialSettings
                compact
                serialSettings={serialSettings}
                onUpdateSettings={updateSerialSettings}
                serial={serial}
                isSupported
              />
            )}

            {!hasRoute ? (
              <p style={{ color: 'var(--kerala-muted)', padding: '2rem 0' }}>
                Select or create a route first under the Routes tab.
              </p>
            ) : (
              <>
                <p className="control-route-line">
                  <strong>{stopInfo.routeName}</strong>
                </p>

                {driverMode && (
                  <div className="gps-status-card" role="status">
                    <div className="gps-status-row">
                      <span>GPS</span>
                      <strong>
                        {gps?.error
                          ? gps.error
                          : gps?.lat != null
                            ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`
                            : 'Acquiring…'}
                      </strong>
                    </div>
                    {gps?.accuracy != null && !gps.error && (
                      <div className="gps-status-row">
                        <span>Accuracy</span>
                        <strong>{formatGpsAccuracy(gps.accuracy)}</strong>
                      </div>
                    )}
                    {atStop && (
                      <div className="gps-status-row highlight">
                        <span>At stop</span>
                        <strong>{atStop.stop.en}</strong>
                      </div>
                    )}
                    {!atStop && nearestStop && (
                      <div className="gps-status-row">
                        <span>Nearest</span>
                        <strong>
                          {nearestStop.stop.en} ({Math.round(nearestStop.distanceM)}m)
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                <div className="route-direction-picker">
                  <span className="route-direction-label">Trip direction (set before starting)</span>
                  <div className="route-direction-options">
                    <button
                      type="button"
                      className={`btn route-direction-btn ${routeDir === 'forward' ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={!canChangeDirection}
                      onClick={() => setRouteDirection('forward')}
                    >
                      {getStopEn(routeOrigin)} → {getStopEn(routeTerminus)}
                    </button>
                    <button
                      type="button"
                      className={`btn route-direction-btn ${routeDir === 'reverse' ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={!canChangeDirection}
                      onClick={() => setRouteDirection('reverse')}
                    >
                      {getStopEn(routeTerminus)} → {getStopEn(routeOrigin)}
                    </button>
                  </div>
                  {!canChangeDirection && (
                    <small className="route-direction-hint">
                      Direction locked after the first departure. Undo back to origin to change.
                    </small>
                  )}
                </div>

                <div className="stop-display-mini">
                  <div className="current-label">
                    {stopInfo.atTripStart ? 'At origin' : 'Last departed'}
                  </div>
                  <div className="current-stop">
                    <BilingualStop
                      stop={stopInfo.atTripStart ? stopInfo.start : stopInfo.current}
                      size="sm"
                    />
                  </div>
                  <div className="stop-meta">
                    <div className="stop-meta-item">
                      <span>Next Stop</span>
                      <strong>
                        <BilingualStop stop={announceTarget} size="sm" />
                      </strong>
                    </div>
                    <div className="stop-meta-item">
                      <span>Final</span>
                      <strong>
                        <BilingualStop stop={stopInfo.final} size="sm" />
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="driver-buttons">
                  <button
                    type="button"
                    className="btn btn-lg btn-announce"
                    onClick={handleAnnounce}
                    disabled={!canAnnounce}
                  >
                    🔊 Announce
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg btn-reverse"
                    onClick={undoForward}
                    disabled={!canUndo}
                    title="Undo accidental forward press"
                  >
                    ◀ Undo
                  </button>
                  <button
                    type="button"
                    className="btn btn-lg btn-forward"
                    onClick={moveForward}
                    disabled={atTripEnd}
                  >
                    Forward ▶
                  </button>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)' }}>
                  Press <strong>Forward</strong> only when the bus <strong>leaves</strong> a stop — that
                  stop is marked complete, and the display and announcement move to the next stop.
                  Use <strong>Announce</strong> to repeat the current next stop anytime. Use{' '}
                  <strong>Undo</strong> if Forward was pressed by mistake.
                </p>

                <div className="progress-bar-wrap">
                  <div className="progress-bar-label">
                    <span>
                      {announceTarget ? (
                        <>
                          Next: {getStopEn(announceTarget)}
                        </>
                      ) : (
                        'Trip complete'
                      )}
                    </span>
                    <span>
                      {state.displayView === 'ad' ? '📢 Ad playing' : '🚌 Route on display'}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${stopInfo.progress}%` }} />
                  </div>
                </div>

                {state.adSettings?.enabled && (state.ads?.length ?? 0) > 0 && (
                  <p className="control-ad-countdown">
                    {state.displayView === 'ad'
                      ? 'Advertisement on display…'
                      : `Next ad in ${nextAdIn}s · Ad ${((state.nextAdIndex ?? 0) % (state.ads?.length ?? 1)) + 1} of ${state.ads?.length ?? 0}`}
                  </p>
                )}

                {state.displayView === 'ad' && (
                  <button type="button" className="btn btn-ghost" style={{ marginTop: '1rem' }} onClick={endAd}>
                    Skip Ad → Back to Route
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'routes' && (
          <>
            {driverMode && <CloudRoutePicker />}
            <RouteManager
            routes={state.routes ?? []}
            activeRouteId={state.activeRouteId}
            onAddRoute={addRoute}
            onSelectRoute={selectRoute}
            onDeleteRoute={deleteRoute}
            onAddStop={addStop}
            onUpdateStopMalayalam={updateStopMalayalam}
            onRemoveStop={removeStop}
            onReorderMiddleStop={reorderMiddleStop}
          />
          </>
        )}

        {tab === 'ads' && (
          <>
            <AdManager
              ads={state.ads ?? []}
              onAddAd={addAd}
              onAddAds={addAds}
              onRemoveAd={removeAd}
              onUpdateAd={updateAd}
              adFormat="fullscreen"
              title="📢 Fullscreen Advertisements"
              emptyHint="No fullscreen ads yet. These play full-screen on the interval below."
            />
            <AdManager
              ads={state.bannerAds ?? []}
              onAddAd={addBannerAd}
              onAddAds={addBannerAds}
              onRemoveAd={removeBannerAd}
              onUpdateAd={updateBannerAd}
              adFormat="banner"
              title="🏷️ Banner Advertisements"
              emptyHint="No banner ads yet. These appear below the route on the passenger screen."
              durationLabel="Each banner duration (sec)"
              defaultDuration={8}
              showAudioUpload={false}
            />
          </>
        )}

        {tab === 'voice' && (
          <AnnouncementManager
            state={state}
            onUpdateFragment={updateAudioFragment}
            onClearFragment={clearAudioFragment}
            onUpdateStopAudio={updateStopAudioClip}
            onClearStopAudio={clearStopAudioClip}
            onUpdateSettings={updateAnnouncementSettings}
            onTestAnnouncement={handleTestAnnouncement}
          />
        )}

        {tab === 'settings' && (
          <div className="panel">
            <h3 className="panel-title">⚙️ Display &amp; Ad Settings</h3>
            <h4 className="settings-section-title">Stop names on display</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Alternate language every (seconds)</label>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={state.displaySettings?.languageAlternateSec ?? 4}
                  onChange={(e) =>
                    updateDisplaySettings({ languageAlternateSec: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginBottom: '1.25rem' }}>
              Passenger screen shows Malayalam, then English, then Malayalam again — each for this many
              seconds (when both names are set).
            </p>
            <h4 className="settings-section-title">Fullscreen advertisements</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Play ad every (seconds)</label>
                <input
                  type="number"
                  min={15}
                  max={600}
                  value={state.adSettings?.intervalSec ?? 90}
                  onChange={(e) => updateAdSettings({ intervalSec: Number(e.target.value) })}
                />
              </div>
              <div className="form-group">
                <label>Each ad duration (seconds)</label>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={state.adSettings?.defaultDurationSec ?? 12}
                  onChange={(e) => updateAdSettings({ defaultDurationSec: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={state.adSettings?.enabled ?? false}
                    onChange={(e) => updateAdSettings({ enabled: e.target.checked })}
                    style={{ marginRight: '0.5rem' }}
                  />
                  Auto-play ads on interval
                </label>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={state.adSettings?.playAudio ?? false}
                    onChange={(e) => updateAdSettings({ playAudio: e.target.checked })}
                    style={{ marginRight: '0.5rem' }}
                  />
                  Play ad audio on display
                </label>
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginTop: '0.5rem' }}>
              One ad plays every {state.adSettings?.intervalSec ?? 90} seconds, cycling through all uploaded
              files in order, then starting again.
            </p>
            <h4 className="settings-section-title">Banner advertisements</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Default banner duration (seconds)</label>
                <input
                  type="number"
                  min={3}
                  max={30}
                  value={state.bannerAdSettings?.defaultDurationSec ?? 8}
                  onChange={(e) =>
                    updateBannerAdSettings({ defaultDurationSec: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={state.bannerAdSettings?.enabled !== false}
                    onChange={(e) => updateBannerAdSettings({ enabled: e.target.checked })}
                    style={{ marginRight: '0.5rem' }}
                  />
                  Show banner ads below route details
                </label>
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginTop: '0.5rem' }}>
              Banner ads rotate while stop details are shown. They are hidden during fullscreen ads.
            </p>

            <SerialSettings
              serialSettings={serialSettings}
              onUpdateSettings={updateSerialSettings}
              serial={serial}
              isSupported={isSerialSupported}
            />
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
