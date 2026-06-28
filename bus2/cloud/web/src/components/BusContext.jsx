import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { isBusOnline } from './FleetMap.jsx';

const BusContext = createContext(null);

/** @typedef {'selected' | 'all' | 'multi'} TargetMode */

export function SelectedBusProvider({ children, defaultBusId = '' }) {
  const [selectedBusId, setSelectedBusId] = useState(defaultBusId);
  const [pushToBus, setPushToBus] = useState(true);
  const [targetMode, setTargetMode] = useState(/** @type {TargetMode} */ ('selected'));
  const [multiBusIds, setMultiBusIds] = useState([]);
  const [buses, setBuses] = useState([]);

  const refreshBuses = useCallback(async () => {
    try {
      const json = await api('/api/buses');
      const list = json.buses ?? [];
      setBuses(list);
      if (list.length && (!selectedBusId || !list.some((b) => b.busId === selectedBusId))) {
        setSelectedBusId(list[0].busId);
      }
    } catch {
      /* offline */
    }
  }, [selectedBusId]);

  useEffect(() => {
    refreshBuses();
    const t = setInterval(refreshBuses, 4000);
    const onRefresh = () => refreshBuses();
    window.addEventListener('adkerala-fleet-refresh', onRefresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('adkerala-fleet-refresh', onRefresh);
    };
  }, [refreshBuses]);

  const targetBusIds = useMemo(() => {
    if (!pushToBus) return [];
    if (targetMode === 'all') return buses.map((b) => b.busId);
    if (targetMode === 'multi') return multiBusIds;
    return selectedBusId ? [selectedBusId] : [];
  }, [pushToBus, targetMode, multiBusIds, buses, selectedBusId]);

  const toggleMultiBus = useCallback((busId) => {
    setMultiBusIds((prev) =>
      prev.includes(busId) ? prev.filter((id) => id !== busId) : [...prev, busId]
    );
  }, []);

  return (
    <BusContext.Provider
      value={{
        selectedBusId,
        setSelectedBusId,
        pushToBus,
        setPushToBus,
        buses,
        refreshBuses,
        targetMode,
        setTargetMode,
        multiBusIds,
        setMultiBusIds,
        toggleMultiBus,
        targetBusIds,
      }}
    >
      {children}
    </BusContext.Provider>
  );
}

export function useSelectedBus() {
  const ctx = useContext(BusContext);
  if (!ctx) throw new Error('useSelectedBus must be used within SelectedBusProvider');
  return ctx;
}

function busLabel(bus) {
  const plate = bus.profile?.plateDisplay || bus.profile?.plate;
  return plate ? `${bus.busId} (${plate})` : bus.busId;
}

export function BusSelector() {
  const {
    selectedBusId,
    setSelectedBusId,
    buses,
    targetMode,
    setTargetMode,
    multiBusIds,
    toggleMultiBus,
  } = useSelectedBus();

  return (
    <div className="toolbar bus-selector">
      <label>
        Selected bus{' '}
        <select value={selectedBusId} onChange={(e) => setSelectedBusId(e.target.value)}>
          {(buses ?? []).map((b) => (
            <option key={b.busId} value={b.busId}>
              {isBusOnline(b.updatedAt) ? '● ' : '○ '}
              {busLabel(b)}
            </option>
          ))}
          {!buses?.length && <option value="">No buses — claim first</option>}
          {buses?.length > 0 && !selectedBusId && <option value="">— select bus —</option>}
        </select>
      </label>
      <label style={{ fontSize: '0.85rem' }}>
        Push target{' '}
        <select value={targetMode} onChange={(e) => setTargetMode(e.target.value)}>
          <option value="selected">Selected bus</option>
          <option value="all">All buses</option>
          <option value="multi">Pick multiple</option>
        </select>
      </label>
      {targetMode === 'multi' && buses.length > 0 && (
        <div className="bus-multi-pick" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {buses.map((b) => (
            <label key={b.busId} style={{ fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={multiBusIds.includes(b.busId)}
                onChange={() => toggleMultiBus(b.busId)}
              />{' '}
              {busLabel(b)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function PushHint() {
  return (
    <p className="hint" style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.8rem' }}>
      Saves go to the cloud catalog immediately. With push enabled, changes queue as commands; buses apply
      within ~5s when online. Media downloads automatically after ack.
    </p>
  );
}
