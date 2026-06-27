import { useEffect } from 'react';
import { useBusStore } from '../hooks/useBusStore';
import { useSerialPort, isWebSerialSupported } from '../hooks/useSerialPort';
import { useEspSerialControl } from '../hooks/useEspSerialControl';
import { useDisplayBrowserFullscreen } from '../hooks/useDisplayBrowserFullscreen';
import { useAnnouncementPlayback } from '../hooks/useAnnouncementPlayback';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { isLaunchedByRunScript } from '../lib/appRole';
import DisplayScreen from './DisplayScreen';

/** Passenger screen — open on bus PC at /display */
export default function DisplayApp() {
  const {
    state,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  } = useBusStore();

  const busPcLaunch = isLaunchedByRunScript();

  useRemoteStateSync(true);
  useAnnouncementPlayback();
  useDisplayBrowserFullscreen(true, exitToControl);

  // ESP32 USB serial stays on the bus PC (display machine).
  const { handleValueChange } = useEspSerialControl({
    state,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  });

  const serialSettings = state.serialSettings ?? {};
  const serialEnabled =
    busPcLaunch &&
    (serialSettings.enabled ?? Boolean(serialSettings.savedPortInfo));
  useSerialPort({
    enabled: serialEnabled && isWebSerialSupported(),
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
    if (!busPcLaunch) return;
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {
      el.requestFullscreen?.().catch(() => {});
    });
  }, [busPcLaunch]);

  return <DisplayScreen passengerMode />;
}
