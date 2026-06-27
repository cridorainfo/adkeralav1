import { Routes, Route } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import { RequireAuth } from '../../lib/auth.jsx';
import { SelectedBusProvider, BusSelector } from '../../components/BusContext.jsx';
import FleetPanel from '../../components/FleetPanel.jsx';
import LiveBusPanel from '../../components/LiveBusPanel.jsx';
import RouteEditor from '../../components/RouteEditor.jsx';
import StopsCatalog from '../../components/StopsCatalog.jsx';
import VoicesPanel from '../../components/VoicesPanel.jsx';
import AdsPanel from '../../components/AdsPanel.jsx';
import ContentGaps from '../../components/ContentGaps.jsx';
import CampaignsPanel from '../../components/CampaignsPanel.jsx';
import RouteCatalog from '../../components/RouteCatalog.jsx';
import ClaimBus from '../../pages/ClaimBus.jsx';
import { useSelectedBus } from '../../components/BusContext.jsx';

const NAV = [
  { to: '', label: 'My fleet', end: true },
  { to: '/claim', label: 'Claim bus' },
  { to: '/live', label: 'Live bus' },
  { to: '/routes', label: 'Routes' },
  { to: '/stops', label: 'Stops' },
  { to: '/voices', label: 'Voices' },
  { to: '/ads', label: 'Ads' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/gaps', label: 'Content gaps' },
  { to: '/catalog', label: 'Route catalog' },
];

function OwnerToolbar() {
  const { pushToBus, setPushToBus } = useSelectedBus();
  return (
    <div className="toolbar">
      <BusSelector />
      <label style={{ fontSize: '0.85rem' }}>
        <input type="checkbox" checked={pushToBus} onChange={(e) => setPushToBus(e.target.checked)} /> Push to selected bus
      </label>
    </div>
  );
}

function OwnerRoutes() {
  return (
    <>
      <OwnerToolbar />
      <Routes>
        <Route index element={<FleetPanel allowRegister />} />
        <Route path="claim" element={<ClaimBus />} />
        <Route path="live" element={<LiveBusPanel />} />
        <Route path="routes" element={<RouteEditor />} />
        <Route path="stops" element={<StopsCatalog />} />
        <Route path="voices" element={<VoicesPanel />} />
        <Route path="ads" element={<AdsPanel />} />
        <Route path="campaigns" element={<CampaignsPanel />} />
        <Route path="gaps" element={<ContentGaps />} />
        <Route path="catalog" element={<RouteCatalog />} />
      </Routes>
    </>
  );
}

export default function OwnerApp() {
  return (
    <RequireAuth roles={['bus_owner']}>
      <SelectedBusProvider>
        <DashboardLayout basePath="/owner" navItems={NAV} title="Bus owner portal">
          <OwnerRoutes />
        </DashboardLayout>
      </SelectedBusProvider>
    </RequireAuth>
  );
}
