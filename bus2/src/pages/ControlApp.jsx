import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useBusStore } from '../hooks/useBusStore';
import DriverControlScreen from './DriverControlScreen';
import HubControlGate from '../components/HubControlGate';

/** Driver control at /control — driver phone (Wi‑Fi). Console USB runs on bus PC /display. */
export default function ControlApp() {
  return (
    <HubControlGate>
      <ControlAppInner />
    </HubControlGate>
  );
}

function ControlAppInner() {
  const { state } = useBusStore();
  useRemoteStateSync(true);

  return <DriverControlScreen serialRuntime={state.serialRuntime} />;
}
