import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  const p = bus.profile ?? {};
  if (p.displayName) return p.displayName;
  const plate = p.plateDisplay || p.plate;
  return plate ? `${plate} (${bus.busId})` : bus.busId;
}

export function busDisplayLabel(bus) {
  return busLabel(bus);
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
      <label className="bus-selector-field">
        <span className="bus-selector-field-label">Selected bus</span>
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
      <label className="bus-selector-field bus-selector-field-sm">
        <span className="bus-selector-field-label">Push target</span>
        <select value={targetMode} onChange={(e) => setTargetMode(e.target.value)}>
          <option value="selected">Selected bus</option>
          <option value="all">All buses</option>
          <option value="multi">Pick multiple</option>
        </select>
      </label>
      {targetMode === 'multi' && buses.length > 0 && (
        <div className="bus-multi-pick">
          {buses.map((b) => (
            <label key={b.busId} className="bus-multi-pick-item">
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
    <p className="hint bus-toolbar-hint">
      Saves go to the cloud catalog immediately. With push enabled, routes and stop names sync to the bus
      within ~5s when online — same as audio and ads.
    </p>
  );
}

/**
 * Renders BusSelector + push-target toggle + PushHint, but ONLY on pages that actually consume
 * selectedBusId/targetBusIds (checked directly against which components call useSelectedBus() —
 * see git log for the exact list) — showing it fleet-wide-only pages (Pricing, House ads, Users,
 * Releases, Media browser, Content gaps, Ads Report, Campaigns, Schedules, Live Wall, Claim bus)
 * was pure clutter, since those pages never read the selected bus or push target at all.
 * Replaces AdminToolbar/OwnerToolbar, which were an identical copy-paste of this same JSX with
 * no such gating — centralized here once instead of duplicated per dashboard.
 *
 * `activePaths` are relative to `basePath` (e.g. '', '/live', '/routes' — matching each
 * dashboard's own NAV `to` values exactly, index route is '').
 */
export function BusToolbar({ basePath, activePaths }) {
  const { pushToBus, setPushToBus } = useSelectedBus();
  const location = useLocation();

  const relative = location.pathname.startsWith(basePath)
    ? location.pathname.slice(basePath.length)
    : location.pathname;
  const normalized = relative.replace(/\/+$/, '');
  if (!activePaths.includes(normalized)) return null;

  return (
    <>
      <div className="toolbar bus-toolbar-push">
        <BusSelector />
        <label className="toggle-switch-field bus-toolbar-push-toggle">
          <span>Enable push</span>
          <span className="toggle-switch">
            <input type="checkbox" checked={pushToBus} onChange={(e) => setPushToBus(e.target.checked)} />
            <span className="toggle-switch-track" />
          </span>
        </label>
      </div>
      <PushHint />
    </>
  );
}
