import { useEffect, useState } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { useSerialPort, isWebSerialSupported } from '../hooks/useSerialPort';
import { useEspSerialControl } from '../hooks/useEspSerialControl';
import { useDisplayBrowserFullscreen } from '../hooks/useDisplayBrowserFullscreen';
import { useAnnouncementPlayback } from '../hooks/useAnnouncementPlayback';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { isKioskMode, isLaunchedByRunScript } from '../lib/appRole';
import SerialSettings from '../components/SerialSettings';
import DriverConnectBanner from '../components/DriverConnectBanner';
import FleetSetupOverlay from '../components/FleetSetupOverlay';
import DisplayScreen from './DisplayScreen';

/** Passenger screen — open on bus PC at /display */
export default function DisplayApp() {
  const {
    state,
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
    updateSerialSettings,
    updateSerialRuntime,
  } = useBusStore();

  const kioskMode = isKioskMode();
  const busPcLaunch = isLaunchedByRunScript() || kioskMode;
  const [settingsOpen, setSettingsOpen] = useState(false);

  useRemoteStateSync(true);
  useAnnouncementPlayback();
  useDisplayBrowserFullscreen(true, exitToControl, kioskMode);

  const { handleValueChange } = useEspSerialControl({
    state,
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  });

  const serialSettings = state.serialSettings ?? {};
  const serial = useSerialPort({
    enabled:
      (serialSettings.enabled ?? Boolean(serialSettings.savedPortInfo)) &&
      isWebSerialSupported(),
    locked: serialSettings.portLocked ?? Boolean(serialSettings.savedPortInfo),
    baudRate: serialSettings.baudRate,
    savedPortInfo: serialSettings.savedPortInfo,
    onValueChange: handleValueChange,
    textCommands: [
      serialSettings.fullscreenCommand ?? 'fullscreen',
      serialSettings.exitCommand ?? 'exit',
    ],
  });

  useEffect(() => {
    updateSerialRuntime({
      status: serial.status,
      portLabel: serial.portLabel || '',
      error: serial.error || '',
      isConnected: serial.isConnected,
    });
  }, [
    serial.status,
    serial.portLabel,
    serial.error,
    serial.isConnected,
    updateSerialRuntime,
  ]);

  useEffect(() => {
    if (!busPcLaunch) return;
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {
      el.requestFullscreen?.().catch(() => {});
    });
  }, [busPcLaunch]);

  return (
    <>
      <FleetSetupOverlay />
      <DisplayScreen passengerMode />
      {kioskMode && (
        <div className="display-kiosk-control-hint">
          <DriverConnectBanner />
        </div>
      )}
      {!kioskMode && isWebSerialSupported() && (
        <>
          <button
            type="button"
            className="display-settings-fab"
            onClick={() => setSettingsOpen((v) => !v)}
            title="ESP32 serial settings"
            aria-label="ESP32 settings"
          >
            ⚙️
          </button>
          {settingsOpen && (
            <div className="display-settings-overlay" role="dialog" aria-label="ESP32 settings">
              <div className="display-settings-panel">
                <div className="display-settings-header">
                  <h3>Bus PC settings</h3>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSettingsOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                <SerialSettings
                  serialSettings={serialSettings}
                  onUpdateSettings={updateSerialSettings}
                  serial={serial}
                  isSupported
                />
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
