import { useBusStore } from '../hooks/useBusStore';
import { useSerialPort, isWebSerialSupported } from '../hooks/useSerialPort';
import { useEspSerialControl } from '../hooks/useEspSerialControl';
import { useAppViewHotkeys } from '../hooks/useAppViewHotkeys';
import { useAnnouncementPlayback } from '../hooks/useAnnouncementPlayback';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useDriverGps } from '../hooks/useDriverGps';
import ControlScreen from './ControlScreen';

/** Driver / conductor panel — open on phone at /control */
export default function ControlApp() {
  const {
    state,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  } = useBusStore();

  useRemoteStateSync(true);
  useDriverGps(true);
  useAnnouncementPlayback();

  const { handleValueChange } = useEspSerialControl({
    state,
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
    enabled: serialSettings.enabled ?? Boolean(serialSettings.savedPortInfo),
    locked: serialSettings.portLocked ?? Boolean(serialSettings.savedPortInfo),
    baudRate: serialSettings.baudRate,
    savedPortInfo: serialSettings.savedPortInfo,
    onValueChange: handleValueChange,
    textCommands: serialTextCommands,
  });

  useAppViewHotkeys({ enterDisplayMode, exitToControl });

  return (
    <ControlScreen
      driverMode
      serial={serial}
      isSerialSupported={isWebSerialSupported()}
    />
  );
}
