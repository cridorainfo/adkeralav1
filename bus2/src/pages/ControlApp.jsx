import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useBusStore } from '../hooks/useBusStore';
import DriverControlScreen from './DriverControlScreen';
import DriverControlGate from '../components/DriverControlGate';

/** Driver control at /control — driver phone (Wi‑Fi). Console USB runs on bus PC /display. */
export default function ControlApp() {
  return (
    <DriverControlGate>
      <ControlAppInner />
    </DriverControlGate>
  );
}

function ControlAppInner() {
  const { state } = useBusStore();
  useRemoteStateSync(true);

  return <DriverControlScreen serialRuntime={state.serialRuntime} />;
}
