import { useBusStore } from '../hooks/useBusStore';
import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useDriverGps } from '../hooks/useDriverGps';
import { useDriverCloudLocation } from '../hooks/useDriverCloudLocation';
import { useGpsAutoDrive } from '../hooks/useGpsAutoDrive';
import ControlScreen from './ControlScreen';
import DriverControlGate from '../components/DriverControlGate';

function ControlAppInner() {
  const {
    state,
    moveForward,
  } = useBusStore();

  useRemoteStateSync(true);
  const { permission: gpsPermission, requestGps } = useDriverGps(true);
  useDriverCloudLocation({ enabled: true, location: state.driverLocation });
  const { status: gpsDriveStatus, isGpsMode } = useGpsAutoDrive({
    enabled: true,
    state,
    driveSettings: state.driveSettings,
    moveForward,
  });

  return (
    <ControlScreen
      driverMode
      serial={null}
      isSerialSupported={false}
      gpsPermission={gpsPermission}
      onRequestGps={requestGps}
      gpsDriveStatus={gpsDriveStatus}
      isGpsDriveMode={isGpsMode}
    />
  );
}

/** Driver / conductor panel — open on phone at /control */
export default function ControlApp() {
  return (
    <DriverControlGate>
      <ControlAppInner />
    </DriverControlGate>
  );
}
