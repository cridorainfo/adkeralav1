import { useRemoteStateSync } from '../hooks/useRemoteStateSync';
import { useBusStore } from '../hooks/useBusStore';
import DriverControlScreen from './DriverControlScreen';
import HubControlGate from '../components/HubControlGate';

/** Driver control at /control — driver phone (Wi‑Fi). Console USB runs on bus PC /display. */
export default function ControlApp() {
  // Start syncing immediately on refresh — do not wait for hub gate unlock.
  useRemoteStateSync(true);

  return (
    <HubControlGate>
      <ControlAppInner />
    </HubControlGate>
  );
}

function ControlAppInner() {
  const { state } = useBusStore();

  return <DriverControlScreen serialRuntime={state.serialRuntime} />;
}
