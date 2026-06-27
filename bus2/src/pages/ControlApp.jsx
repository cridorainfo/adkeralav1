import { useBusStore } from '../hooks/useBusStore';
import { useSerialPort, isWebSerialSupported } from '../hooks/useSerialPort';
import { useEspSerialControl } from '../hooks/useEspSerialControl';
import { useAppViewHotkeys } from '../hooks/useAppViewHotkeys';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useDriverGps } from '../hooks/useDriverGps';
import { useGpsAutoDrive } from '../hooks/useGpsAutoDrive';
import ControlScreen from './ControlScreen';

/** Driver / conductor panel — open on phone at /control */
export default function ControlApp() {
  const {
    state,
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  } = useBusStore();

  useRemoteStateSync(true);
  const { permission: gpsPermission, requestGps } = useDriverGps(true);
  const { status: gpsDriveStatus, isGpsMode } = useGpsAutoDrive({
    enabled: true,
    state,
    driveSettings: state.driveSettings,
    moveForward,
  });

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
      gpsPermission={gpsPermission}
      onRequestGps={requestGps}
      gpsDriveStatus={gpsDriveStatus}
      isGpsDriveMode={isGpsMode}
    />
  );
}
