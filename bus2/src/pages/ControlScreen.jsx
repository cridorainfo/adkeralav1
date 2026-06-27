import { useEffect, useState, useCallback } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { getStopInfo, getStopEn, sameStop, getUpcomingPassengerStop } from '../store/busStore';
import { APP_NAME, APP_CONTROL_SUBTITLE } from '../lib/brand';
import RouteManager from '../components/RouteManager';
import AdManager from '../components/AdManager';
import AnnouncementManager from '../components/AnnouncementManager';
import SerialSettings from '../components/SerialSettings';
import { BilingualStop } from '../components/BilingualStop';
import CloudRoutePicker from '../components/CloudRoutePicker';
import DriveRouteSelector from '../components/DriveRouteSelector';
import { canPlayAnnouncement } from '../lib/audioFragments';
import { useCloudRouteSearch } from '../hooks/useCloudRouteSearch';
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

const DRIVER_ADS_PASSWORD = 'adpassword';

export default function ControlScreen({
  serial,
  isSerialSupported = false,
  driverMode = false,
  gpsPermission = 'unknown',
  onRequestGps,
}) {
  const {
    state,
    storageError,
    clearStorageError,
    addRoute,
    importRoute,
    deleteRoute,
    addStop,
    updateStopMalayalam,
    removeStop,
    reorderMiddleStop,
    mergeStopCatalog,
    updateStopLocation,
    selectRoute,
    startTrip,
    endTrip,
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
    commitServerState,
  } = useBusStore();

  const [tab, setTab] = useState('drive');
  const [, tick] = useState(0);
  const [adsUnlocked, setAdsUnlocked] = useState(false);
  const [adsPasswordInput, setAdsPasswordInput] = useState('');
  const [adsPasswordError, setAdsPasswordError] = useState(false);
  const { cloudEnabled, assignToBus } = useCloudRouteSearch();

  const handleKeepSharedRoute = useCallback(
    async (routeId) => {
      const json = await assignToBus(routeId);
      if (json.state) commitServerState(json.state);
      if (driverMode) setTab('drive');
      return json;
    },
    [assignToBus, commitServerState, driverMode]
  );

  const handleSelectRoute = useCallback(
    (id) => {
      selectRoute(id);
      if (driverMode) setTab('drive');
    },
    [selectRoute, driverMode]
  );

  const handleRouteActivated = useCallback(() => {
    if (driverMode) setTab('drive');
  }, [driverMode]);

  const handlePublishRoute = useCallback(async (route) => {
    const res = await fetch('/api/cloud/publish-route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: route.id,
        name: route.name,
        startStop: route.startStop,
        endStop: route.endStop,
        stops: route.stops ?? [],
      }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Could not share route');
    return json;
  }, []);

  const busRoutes = state.routes ?? [];
  const hasBusRoutes = busRoutes.length > 0;
  const serialSettings = state.serialSettings ?? {};
  const stopInfo = getStopInfo(state);
  const hasRoute = !!state.activeRouteId;
  const routeDir = state.routeDirection ?? 'forward';
  const atTripEnd = stopInfo.atTripEnd;
  const tripStarted = Boolean(state.tripStarted);
  const tripEnded = Boolean(state.tripEnded);
  const canUndo = tripStarted && !tripEnded && Boolean(state.tripDeparted);
  const showStartButton = hasRoute && !tripStarted;
  const showEndButton = hasRoute && tripStarted && atTripEnd && !tripEnded;
  const showForwardButton = hasRoute && tripStarted && !atTripEnd && !tripEnded;
  const nextAdIn = secsUntilNextAd(state);
  const routeStops = stopInfo.allStops ?? [];
  const tripStopsOrdered =
    routeDir === 'reverse' ? [...routeStops].reverse() : routeStops;
  const routeStopsText = tripStopsOrdered.map(getStopEn).join(', ');
  const announceTarget = getUpcomingPassengerStop(state);
  const canAnnounce =
    hasRoute &&
    announceTarget &&
    canPlayAnnouncement(state, announceTarget);

  const displayLive =
    state.displayView === 'ad' || (tripStarted && !tripEnded) || tripEnded;

  const gps = state.driverLocation;
  const nearestStop =
    gps?.lat != null && gps?.lng != null ? findNearestStopOnRoute(state, gps.lat, gps.lng) : null;
  const atStop =
    gps?.lat != null && gps?.lng != null ? findStopAtLocation(state, gps.lat, gps.lng) : null;

  const visibleTabs = driverMode
    ? ['drive', 'routes', 'ads', 'settings']
    : ['drive', 'routes', 'ads', 'voice', 'settings'];

  const handleAnnounce = () => {
    if (!announceTarget) return;
    const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
    requestAnnouncement(announceTarget, { isTerminus });
  };

  const handleTestAnnouncement = (stop, isTerminus) => {
    requestAnnouncement(stop, { isTerminus });
  };

  const handleAdsUnlock = (e) => {
    e.preventDefault();
    if (adsPasswordInput === DRIVER_ADS_PASSWORD) {
      setAdsUnlocked(true);
      setAdsPasswordError(false);
      setAdsPasswordInput('');
      return;
    }
    setAdsPasswordError(true);
  };

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tabs = driverMode
      ? ['drive', 'routes', 'ads', 'settings']
      : ['drive', 'routes', 'ads', 'voice', 'settings'];
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, driverMode]);

  useEffect(() => {
    if (tab !== 'ads') {
      setAdsUnlocked(false);
      setAdsPasswordInput('');
      setAdsPasswordError(false);
    }
  }, [tab]);

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

            {driverMode && (
              <div
                className={`serial-status-bar serial-status-bar--remote ${state.serialRuntime?.isConnected ? 'connected' : ''}`}
                role="status"
              >
                <span className="serial-status-dot" aria-hidden />
                <span className="serial-status-text">
                  ESP32 on bus PC:{' '}
                  {state.serialRuntime?.status
                    ? (state.serialRuntime.isConnected ? 'Connected' : state.serialRuntime.status)
                    : 'No status yet'}
                  {state.serialRuntime?.portLabel ? ` · ${state.serialRuntime.portLabel}` : ''}
                </span>
                <span className="serial-status-text serial-status-text--hint">
                  Fix in Settings → ESP32
                </span>
              </div>
            )}

            {!driverMode && isSerialSupported && serialSettings.enabled && serial && (
              <SerialSettings
                compact
                serialSettings={serialSettings}
                onUpdateSettings={updateSerialSettings}
                serial={serial}
                isSupported
              />
            )}

            {!hasBusRoutes ? (
              <div className="drive-no-route">
                <p>No routes on this bus yet.</p>
                <p className="drive-no-route-hint">
                  Open the <strong>Routes</strong> tab to add a shared route or create a new one —
                  then return here to select it and drive.
                </p>
                {driverMode && (
                  <button type="button" className="btn btn-primary" onClick={() => setTab('routes')}>
                    Go to Routes
                  </button>
                )}
              </div>
            ) : (
              <>
                <DriveRouteSelector
                  routes={busRoutes}
                  activeRouteId={state.activeRouteId}
                  routeDirection={routeDir}
                  tripInProgress={tripStarted && !tripEnded}
                  onSelectRoute={handleSelectRoute}
                  onSetRouteDirection={setRouteDirection}
                />

                {!hasRoute ? (
                  <p className="drive-pick-route-hint">
                    Tap a route above to activate it, choose direction, then press <strong>Start</strong>.
                  </p>
                ) : (
              <>
                {driverMode && routeStopsText && (
                  <details className="drive-route-stops-detail" open>
                    <summary className="drive-route-stops-summary">All stops (trip order)</summary>
                    <p className="drive-route-stops-text">{routeStopsText}</p>
                  </details>
                )}

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
                    {(gpsPermission === 'denied' || gpsPermission === 'prompt') && onRequestGps && (
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gps-enable-btn"
                        onClick={onRequestGps}
                      >
                        Enable location
                      </button>
                    )}
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

                <div className="stop-display-mini">
                  <div className="current-label">
                    {!tripStarted
                      ? 'Ready to start'
                      : tripEnded
                        ? 'Trip complete'
                        : stopInfo.atTripStart
                          ? 'At origin'
                          : 'Last departed'}
                  </div>
                  <div className="current-stop">
                    <BilingualStop
                      stop={
                        tripEnded
                          ? stopInfo.final
                          : !tripStarted || stopInfo.atTripStart
                            ? stopInfo.start
                            : stopInfo.current
                      }
                      size="sm"
                    />
                  </div>
                  <div className="stop-meta">
                    <div className="stop-meta-item">
                      <span>Next Stop</span>
                      <strong>
                        {announceTarget ? (
                          <BilingualStop stop={announceTarget} size="sm" />
                        ) : (
                          '—'
                        )}
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
                    disabled={!canAnnounce || !tripStarted || tripEnded}
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
                  {showStartButton && (
                    <button
                      type="button"
                      className="btn btn-lg btn-start"
                      onClick={startTrip}
                    >
                      Start ▶
                    </button>
                  )}
                  {showForwardButton && (
                    <button
                      type="button"
                      className="btn btn-lg btn-forward"
                      onClick={moveForward}
                    >
                      Forward ▶
                    </button>
                  )}
                  {showEndButton && (
                    <button
                      type="button"
                      className="btn btn-lg btn-end"
                      onClick={endTrip}
                    >
                      End ✓
                    </button>
                  )}
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)' }}>
                  {showStartButton && (
                    <>
                      Press <strong>Start</strong> to show the origin on the passenger display, then
                      use <strong>Forward</strong> each time the bus leaves a stop.
                    </>
                  )}
                  {showForwardButton && (
                    <>
                      Press <strong>Forward</strong> only when the bus <strong>leaves</strong> a stop —
                      the display and announcement move to the next stop. Use{' '}
                      <strong>Announce</strong> to repeat the current next stop anytime. Use{' '}
                      <strong>Undo</strong> if Forward was pressed by mistake.
                    </>
                  )}
                  {showEndButton && (
                    <>
                      You have reached the final stop. Press <strong>End</strong> to show{' '}
                      <strong>destination reached</strong> on the display, then <strong>Start</strong>{' '}
                      again for the next trip.
                    </>
                  )}
                  {tripEnded && (
                    <>
                      Trip complete — destination shown on display. Press <strong>Start</strong> to
                      begin again.
                    </>
                  )}
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
              </>
            )}
          </div>
        )}

        {tab === 'routes' && (
          <>
            {driverMode && (
              <CloudRoutePicker onAssigned={handleRouteActivated} />
            )}
            <RouteManager
            routes={state.routes ?? []}
            activeRouteId={state.activeRouteId}
            driverLocation={gps}
            stopCatalog={state.stopCatalog ?? []}
            cloudEnabled={cloudEnabled}
            onAddRoute={addRoute}
            onImportRoute={importRoute}
            onSelectRoute={handleSelectRoute}
            onDeleteRoute={deleteRoute}
            onAddStop={addStop}
            onUpdateStopMalayalam={updateStopMalayalam}
            onRemoveStop={removeStop}
            onReorderMiddleStop={reorderMiddleStop}
            onUpdateStopLocation={updateStopLocation}
            onPublishRoute={cloudEnabled ? handlePublishRoute : null}
            onMergeCatalog={mergeStopCatalog}
            onAssignSharedRoute={driverMode && cloudEnabled ? handleKeepSharedRoute : null}
            onRouteActivated={driverMode ? handleRouteActivated : null}
            driverMode={driverMode}
          />
          </>
        )}

        {tab === 'ads' && (
          <>
            {driverMode && !adsUnlocked ? (
              <div className="panel driver-ads-gate" style={{ maxWidth: 420, margin: '0 auto' }}>
                <h3 className="panel-title">📢 Advertisements</h3>
                <p className="driver-ads-gate-hint">
                  Enter the password to upload, edit, or remove ads on this bus.
                </p>
                <form className="driver-ads-gate-form" onSubmit={handleAdsUnlock}>
                  <div className="form-group">
                    <label htmlFor="driver-ads-password">Password</label>
                    <input
                      id="driver-ads-password"
                      type="password"
                      value={adsPasswordInput}
                      onChange={(e) => {
                        setAdsPasswordInput(e.target.value);
                        if (adsPasswordError) setAdsPasswordError(false);
                      }}
                      autoComplete="off"
                      placeholder="Enter password"
                    />
                  </div>
                  {adsPasswordError && (
                    <p className="driver-ads-gate-error" role="alert">
                      Incorrect password. Try again.
                    </p>
                  )}
                  <button type="submit" className="btn btn-primary">
                    Unlock ads
                  </button>
                </form>
              </div>
            ) : (
              <>
                {driverMode && (
                  <div className="driver-ads-unlocked-bar">
                    <span>Ads management unlocked</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setAdsUnlocked(false)}
                    >
                      Lock
                    </button>
                  </div>
                )}
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
                {driverMode && (
                  <div className="panel">
                    <h3 className="panel-title">⚙️ Ad playback settings</h3>
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
                          onChange={(e) =>
                            updateAdSettings({ defaultDurationSec: Number(e.target.value) })
                          }
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
                  </div>
                )}
              </>
            )}
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
            <h3 className="panel-title">⚙️ {driverMode ? 'Settings' : 'Display & Ad Settings'}</h3>

            {driverMode && (
              <SerialSettings
                remoteConfig
                serialSettings={serialSettings}
                onUpdateSettings={updateSerialSettings}
                serialRuntime={state.serialRuntime}
                isSupported={false}
              />
            )}

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

            {!driverMode && (
              <SerialSettings
                serialSettings={serialSettings}
                onUpdateSettings={updateSerialSettings}
                serial={serial}
                isSupported={isSerialSupported}
              />
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
