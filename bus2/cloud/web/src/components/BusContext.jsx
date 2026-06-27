import { createContext, useContext, useState } from 'react';

const BusContext = createContext(null);

export function SelectedBusProvider({ children, defaultBusId = 'bus-1' }) {
  const [selectedBusId, setSelectedBusId] = useState(defaultBusId);
  const [pushToBus, setPushToBus] = useState(true);

  return (
    <BusContext.Provider value={{ selectedBusId, setSelectedBusId, pushToBus, setPushToBus }}>
      {children}
    </BusContext.Provider>
  );
}

export function useSelectedBus() {
  const ctx = useContext(BusContext);
  if (!ctx) throw new Error('useSelectedBus must be used within SelectedBusProvider');
  return ctx;
}

export function BusSelector({ buses }) {
  const { selectedBusId, setSelectedBusId } = useSelectedBus();
  return (
    <div className="toolbar">
      <label>
        Selected bus{' '}
        <select value={selectedBusId} onChange={(e) => setSelectedBusId(e.target.value)}>
          {(buses ?? []).map((b) => (
            <option key={b.busId} value={b.busId}>
              {b.busId}
            </option>
          ))}
          {!buses?.length && <option value={selectedBusId}>{selectedBusId}</option>}
        </select>
      </label>
    </div>
  );
}
