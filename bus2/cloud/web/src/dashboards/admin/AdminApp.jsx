import { Routes, Route, Navigate } from 'react-router-dom';
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
import UsersPanel from '../../components/UsersPanel.jsx';
import CampaignsPanel from '../../components/CampaignsPanel.jsx';
import ReleasesPanel from '../../components/ReleasesPanel.jsx';
import RouteCatalog from '../../components/RouteCatalog.jsx';
import { useSelectedBus } from '../../components/BusContext.jsx';

const NAV = [
  { to: '', label: 'Fleet', end: true },
  { to: '/live', label: 'Live bus' },
  { to: '/routes', label: 'Routes' },
  { to: '/stops', label: 'Stops' },
  { to: '/voices', label: 'Voices' },
  { to: '/ads', label: 'Ads' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/gaps', label: 'Content gaps' },
  { to: '/catalog', label: 'Route catalog' },
  { to: '/users', label: 'Users' },
  { to: '/releases', label: 'Releases' },
];

function AdminToolbar() {
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

function AdminRoutes() {
  return (
    <>
      <AdminToolbar />
      <Routes>
        <Route index element={<FleetPanel allowRegister />} />
        <Route path="live" element={<LiveBusPanel />} />
        <Route path="routes" element={<RouteEditor />} />
        <Route path="stops" element={<StopsCatalog />} />
        <Route path="voices" element={<VoicesPanel />} />
        <Route path="ads" element={<AdsPanel />} />
        <Route path="campaigns" element={<CampaignsPanel adminMode />} />
        <Route path="gaps" element={<ContentGaps />} />
        <Route path="catalog" element={<RouteCatalog />} />
        <Route path="users" element={<UsersPanel />} />
        <Route path="releases" element={<ReleasesPanel />} />
      </Routes>
    </>
  );
}

export default function AdminApp() {
  return (
    <RequireAuth roles={['admin']}>
      <SelectedBusProvider>
        <DashboardLayout basePath="/admin" navItems={NAV} title="Admin dashboard">
          <AdminRoutes />
        </DashboardLayout>
      </SelectedBusProvider>
    </RequireAuth>
  );
}
