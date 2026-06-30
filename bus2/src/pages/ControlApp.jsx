import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useBusStore } from '../hooks/useBusStore';
import DriverControlScreen from './DriverControlScreen';
import DriverControlGate from '../components/DriverControlGate';

/** Driver control at /control — driver phone (Wi‑Fi). ESP32 USB runs on bus PC /display. */
export default function ControlApp() {
  return (
    <DriverControlGate>
      <ControlAppInner />
    </DriverControlGate>
  );
}

function ControlAppInner() {
  const { state, updateSerialSettings } = useBusStore();
  useRemoteStateSync(true);

  return (
    <DriverControlScreen
      serialSettings={state.serialSettings ?? {}}
      serialRuntime={state.serialRuntime}
      onUpdateSerialSettings={updateSerialSettings}
    />
  );
}
