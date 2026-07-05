import { useEffect, useState, useCallback } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { getStopInfo, getStopEn, sameStop, getUpcomingPassengerStop, getDriverVisibleRoutes } from '../store/busStore';
import AdKeralaLogo from '../components/AdKeralaLogo';
import { APP_NAME, APP_CONTROL_SUBTITLE } from '../lib/brand';
import RouteManager from '../components/RouteManager';
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
import { useDriverControl } from '../components/DriverControlContext';
import GpsPermissionBanner from '../components/GpsPermissionBanner';

const DRIVER_TABS = ['drive', 'routes', 'settings'];
const ADMIN_TABS = ['drive', 'routes', 'voice', 'settings'];

export default function ControlScreen({
  serial,
  isSerialSupported = false,
  driverMode = false,
  gpsPermission = 'unknown',
  onRequestGps,
  gpsDriveStatus = null,
  isGpsDriveMode = false,
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
    updateSerialSettings,
    updateDisplaySettings,
    updateAnnouncementSettings,
    updateDriveSettings,
    updateAudioFragment,
    clearAudioFragment,
    updateStopAudioClip,
    clearStopAudioClip,
    requestAnnouncement,
  } = useBusStore();

  const [tab, setTab] = useState('drive');
  const [unlinkStatus, setUnlinkStatus] = useState('');
  const { disconnect: disconnectDriverPhone } = useDriverControl();
  const { cloudEnabled } = useCloudRouteSearch();

  const handleSelectRoute = useCallback(
    (id) => {
      selectRoute(id);
      if (driverMode) setTab('drive');
    },
    [selectRoute, driverMode]
  );

  const handleUnlinkDriver = useCallback(async () => {
    setUnlinkStatus('Unlinking…');
    try {
      const res = await fetch('/api/cloud/driver/unlink', { method: 'POST' });
      const json = await res.json();
      setUnlinkStatus(json.ok ? 'Driver unlinked — new code on display' : (json.error ?? 'Failed'));
    } catch {
      setUnlinkStatus('Could not reach cloud');
    }
  }, []);

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

  const busRoutes = driverMode ? getDriverVisibleRoutes(state) : (state.routes ?? []);
  const activeRouteId =
    busRoutes.some((r) => r.id === state.activeRouteId) ? state.activeRouteId : (busRoutes[0]?.id ?? null);
  const hasBusRoutes = busRoutes.length > 0;
  const hasRoute = Boolean(activeRouteId && busRoutes.some((r) => r.id === activeRouteId));
  const driverState = driverMode ? { ...state, routes: busRoutes, activeRouteId } : state;
  const serialSettings = state.serialSettings ?? {};
  const stopInfo = getStopInfo(driverState);
  const routeDir = state.routeDirection ?? 'forward';
  const atTripEnd = stopInfo.atTripEnd;
  const tripStarted = Boolean(state.tripStarted);
  const tripEnded = Boolean(state.tripEnded);
  const canUndo = tripStarted && !tripEnded && Boolean(state.tripDeparted);
  const showStartButton = hasRoute && !tripStarted;
  const showEndButton = hasRoute && tripStarted && atTripEnd && !tripEnded;
  const showForwardButton = hasRoute && tripStarted && !atTripEnd && !tripEnded;
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
    (tripStarted && !tripEnded) || tripEnded;

  const gps = state.driverLocation;
  const driveSettings = state.driveSettings ?? {};
  const driveMode = driveSettings.mode ?? 'manual';
  const nearestStop =
    gps?.lat != null && gps?.lng != null ? findNearestStopOnRoute(state, gps.lat, gps.lng) : null;
  const atStop =
    gps?.lat != null && gps?.lng != null ? findStopAtLocation(state, gps.lat, gps.lng) : null;

  const visibleTabs = driverMode ? DRIVER_TABS : ADMIN_TABS;

  const handleAnnounce = () => {
    if (!announceTarget) return;
    const isTerminus = stopInfo.final && sameStop(announceTarget, stopInfo.final);
    requestAnnouncement(announceTarget, { isTerminus });
  };

  const handleTestAnnouncement = (stop, isTerminus) => {
    requestAnnouncement(stop, { isTerminus });
  };

  useEffect(() => {
    const tabs = driverMode ? DRIVER_TABS : ADMIN_TABS;
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, driverMode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  return (
    <div className="screen-shell">
      <header className="screen-header">
        <div className="screen-header-brand">
          <AdKeralaLogo size="sm" />
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
                  Console on bus PC:{' '}
                  {state.serialRuntime?.status
                    ? (state.serialRuntime.isConnected ? 'Connected' : state.serialRuntime.status)
                    : 'No status yet'}
                  {state.serialRuntime?.portLabel ? ` · ${state.serialRuntime.portLabel}` : ''}
                  {state.serialRuntime?.lastLine ? ` · last: ${state.serialRuntime.lastLine}` : ''}
                </span>
                <span className="serial-status-text serial-status-text--hint">
                  Serial runs on bus display PC — not this phone
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
                  {driverMode ? (
                    <>
                      Routes appear here after an admin assigns them from the cloud dashboard.
                      This phone only shows server-assigned routes — not local drafts or old cache.
                    </>
                  ) : (
                    <>
                      Open the <strong>Routes</strong> tab to add a shared route or create a new one —
                      then return here to select it and drive.
                    </>
                  )}
                </p>
                {!driverMode && (
                  <button type="button" className="btn btn-primary" onClick={() => setTab('routes')}>
                    Go to Routes
                  </button>
                )}
              </div>
            ) : (
              <>
                <DriveRouteSelector
                  routes={busRoutes}
                  activeRouteId={activeRouteId}
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
                  <>
                    <GpsPermissionBanner
                      permission={gpsPermission}
                      onEnable={onRequestGps}
                      compact
                    />
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
                    {(gpsPermission === 'denied' || gpsPermission === 'prompt' || gpsPermission === 'unknown') &&
                      onRequestGps && (
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
                  </>
                )}

                {driverMode && (
                  <div className="drive-mode-card">
                    <div className="drive-mode-header">
                      <span className="drive-mode-label">Stop advance mode</span>
                      <div className="drive-mode-toggle" role="group" aria-label="Stop advance mode">
                        <button
                          type="button"
                          className={driveMode === 'manual' ? 'active' : ''}
                          onClick={() => updateDriveSettings({ mode: 'manual' })}
                        >
                          Manual
                        </button>
                        <button
                          type="button"
                          className={driveMode === 'gps' ? 'active' : ''}
                          onClick={() => updateDriveSettings({ mode: 'gps' })}
                        >
                          GPS auto
                        </button>
                      </div>
                    </div>
                    {driveMode === 'manual' ? (
                      <p className="drive-mode-hint">
                        Press <strong>Forward</strong> when the bus leaves each stop.
                      </p>
                    ) : (
                      <>
                        <p className="drive-mode-hint">
                          Stops advance automatically when the bus leaves a stop geofence.
                          Announcements use the same rules as manual Forward.
                        </p>
                        {gpsDriveStatus?.message && (
                          <p className={`gps-drive-status phase-${gpsDriveStatus.phase ?? 'watching'}`}>
                            {gpsDriveStatus.message}
                          </p>
                        )}
                        {!isGpsDriveMode && (
                          <p className="drive-mode-hint">Switch to GPS auto to enable.</p>
                        )}
                      </>
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
                  {showForwardButton && driveMode === 'manual' && (
                    <>
                      Press <strong>Forward</strong> only when the bus <strong>leaves</strong> a stop —
                      the display and announcement move to the next stop. Use{' '}
                      <strong>Announce</strong> to repeat the current next stop anytime. Use{' '}
                      <strong>Undo</strong> if Forward was pressed by mistake.
                    </>
                  )}
                  {showForwardButton && driveMode === 'gps' && (
                    <>
                      <strong>GPS auto</strong> advances when you leave each stop.{' '}
                      <strong>Forward</strong> still works as a backup. Use <strong>Undo</strong> if
                      needed.
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
                      {state.displayView === 'ad' ? '📢 Ad on display' : '🚌 Route on display'}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${stopInfo.progress}%` }} />
                  </div>
                </div>

              </>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'routes' && (
          <>
            {driverMode ? (
              <>
                <div className="panel">
                  <h3 className="panel-title">📋 Assigned routes</h3>
                  <p className="panel-hint">
                    Only routes assigned from the admin dashboard appear here. Routes are not
                    stored on this phone until the server pushes them to the bus.
                  </p>
                  {!hasBusRoutes ? (
                    <p className="panel-hint">No routes assigned yet — ask admin to assign from the cloud portal.</p>
                  ) : (
                    <ul className="route-list">
                      {busRoutes.map((route) => (
                        <li
                          key={route.id}
                          className={`route-item ${route.id === activeRouteId ? 'active' : ''}`}
                          onClick={() => handleSelectRoute(route.id)}
                        >
                          <div className="route-item-info">
                            <strong>{route.name}</strong>
                            <small>
                              {route.id}
                              {' · '}
                              Assigned from server
                            </small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {hasBusRoutes && (
                  <RouteManager
                    routes={busRoutes}
                    activeRouteId={activeRouteId}
                    driverLocation={gps}
                    stopCatalog={state.stopCatalog ?? []}
                    cloudEnabled={false}
                    onSelectRoute={handleSelectRoute}
                    onUpdateStopLocation={updateStopLocation}
                    driverMode
                    assignedRoutesOnly
                    onRouteActivated={handleRouteActivated}
                  />
                )}
              </>
            ) : (
              <>
                <CloudRoutePicker onAssigned={handleRouteActivated} />
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
                  onAssignSharedRoute={null}
                  driverMode={false}
                />
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
            <h3 className="panel-title">⚙️ {driverMode ? 'Settings' : 'Display settings'}</h3>

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

            {driverMode && (
              <>
                <h4 className="settings-section-title">This phone</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginBottom: '0.75rem' }}>
                  Disconnect to lock the control panel and show the pairing QR on the bus display again.
                </p>
                <button type="button" className="btn secondary" onClick={disconnectDriverPhone}>
                  Disconnect from this bus
                </button>
              </>
            )}

            {!driverMode && state.driverLink?.driverId && (
              <>
                <h4 className="settings-section-title">Driver pairing</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginBottom: '0.75rem' }}>
                  A driver app is linked to this bus. Unlink to show a new pairing code on the display.
                </p>
                <button type="button" className="btn secondary" onClick={handleUnlinkDriver}>
                  Unlink driver
                </button>
                {unlinkStatus && (
                  <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{unlinkStatus}</p>
                )}
              </>
            )}

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
