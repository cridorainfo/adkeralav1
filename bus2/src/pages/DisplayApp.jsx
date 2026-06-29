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
import UpdateOverlay from '../components/UpdateOverlay';
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
  const serialSupported = isWebSerialSupported();
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
  const serialTextCommands = [
    serialSettings.fullscreenCommand ?? 'fullscreen',
    serialSettings.exitCommand ?? 'exit',
  ];
  const serial = useSerialPort({
    enabled:
      (serialSettings.enabled ?? Boolean(serialSettings.savedPortInfo)) && serialSupported,
    locked: serialSettings.portLocked ?? Boolean(serialSettings.savedPortInfo),
    baudRate: serialSettings.baudRate,
    savedPortInfo: serialSettings.savedPortInfo,
    onValueChange: handleValueChange,
    textCommands: serialTextCommands,
  });

  useEffect(() => {
    updateSerialRuntime({
      status: serial.status,
      portLabel: serial.portLabel || '',
      error: serial.error || '',
      isConnected: serial.isConnected,
      lastLine: serial.lastLine || '',
    });
  }, [
    serial.status,
    serial.portLabel,
    serial.error,
    serial.isConnected,
    serial.lastLine,
    updateSerialRuntime,
  ]);

  useEffect(() => {
    if (!busPcLaunch) return;
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {
      el.requestFullscreen?.().catch(() => {});
    });
  }, [busPcLaunch]);

  useEffect(() => {
    if (!serialSupported) return undefined;

    const onKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [serialSupported]);

  return (
    <>
      <FleetSetupOverlay />
      {kioskMode && <UpdateOverlay />}
      <DisplayScreen passengerMode />
      {kioskMode && !state.driverLink?.driverId && (
        <div className="display-kiosk-control-hint">
          <DriverConnectBanner />
        </div>
      )}
      {serialSupported && (
        <>
          <button
            type="button"
            className={`display-settings-fab ${kioskMode ? 'display-settings-fab--kiosk' : ''}`}
            onClick={() => setSettingsOpen((v) => !v)}
            title="ESP32 serial settings (Ctrl+Shift+S)"
            aria-label="ESP32 settings"
          >
            ⚙️
          </button>
          {settingsOpen && (
            <div className="display-settings-overlay" role="dialog" aria-label="ESP32 settings">
              <div className="display-settings-panel">
                <div className="display-settings-header">
                  <h3>Bus PC — ESP32 settings</h3>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setSettingsOpen(false)}
                  >
                    ✕
                  </button>
                </div>
                {kioskMode && (
                  <p className="serial-hint" style={{ marginTop: 0 }}>
                    Connect the ESP32 USB cable to this PC, click <strong>Select COM Port</strong>,
                    then press buttons to verify <strong>Received:</strong> updates below.
                  </p>
                )}
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
