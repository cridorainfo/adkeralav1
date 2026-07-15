import { Routes, Route } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import { RequireAuth } from '../../lib/auth.jsx';
import { SelectedBusProvider, BusSelector, PushHint } from '../../components/BusContext.jsx';
import FleetPanel from '../../components/FleetPanel.jsx';
import LiveBusPanel from '../../components/LiveBusPanel.jsx';
import LiveWallPanel from '../../components/LiveWallPanel.jsx';
import AdsFleetReport from '../../components/AdsFleetReport.jsx';
import RouteEditor from '../../components/RouteEditor.jsx';
import StopsCatalog from '../../components/StopsCatalog.jsx';
import VoicesPanel from '../../components/VoicesPanel.jsx';
import AdsPanel from '../../components/AdsPanel.jsx';
import ContentGaps from '../../components/ContentGaps.jsx';
import UsersPanel from '../../components/UsersPanel.jsx';
import CampaignsPanel from '../../components/CampaignsPanel.jsx';
import PricingPanel from '../../components/PricingPanel.jsx';
import HouseAdsPanel from '../../components/HouseAdsPanel.jsx';
import MediaBrowserPanel from '../../components/MediaBrowserPanel.jsx';
import ReleasesPanel from '../../components/ReleasesPanel.jsx';
import ClaimBus from '../../pages/ClaimBus.jsx';
import DisplaySettingsPanel from '../../components/DisplaySettingsPanel.jsx';
import RouteCatalog from '../../components/RouteCatalog.jsx';
import { useSelectedBus } from '../../components/BusContext.jsx';

const NAV = [
  { to: '', label: 'Fleet', end: true },
  { to: '/claim', label: 'Claim bus' },
  { to: '/live', label: 'Live bus' },
  { to: '/monitor', label: 'Live Wall' },
  { to: '/routes', label: 'Routes' },
  { to: '/stops', label: 'Stops' },
  { to: '/voices', label: 'Voices' },
  { to: '/ads', label: 'Ads' },
  { to: '/ads-report', label: 'Ads Report' },
  { to: '/display', label: 'Display' },
  { to: '/campaigns', label: 'Campaigns' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/house-ads', label: 'House ads' },
  { to: '/media', label: 'Media browser' },
  { to: '/gaps', label: 'Content gaps' },
  { to: '/catalog', label: 'Route catalog' },
  { to: '/users', label: 'Users' },
  { to: '/releases', label: 'Releases' },
];

function AdminToolbar() {
  const { pushToBus, setPushToBus } = useSelectedBus();
  return (
    <>
      <div className="toolbar">
        <BusSelector />
        <label style={{ fontSize: '0.85rem' }}>
          <input type="checkbox" checked={pushToBus} onChange={(e) => setPushToBus(e.target.checked)} /> Enable push
        </label>
      </div>
      <PushHint />
    </>
  );
}

function AdminRoutes() {
  return (
    <>
      <AdminToolbar />
      <Routes>
        <Route index element={<FleetPanel allowRegister claimHref="/admin/claim" />} />
        <Route path="claim" element={<ClaimBus />} />
        <Route path="live" element={<LiveBusPanel />} />
        <Route path="monitor" element={<LiveWallPanel />} />
        <Route path="routes" element={<RouteEditor />} />
        <Route path="stops" element={<StopsCatalog />} />
        <Route path="voices" element={<VoicesPanel />} />
        <Route path="ads" element={<AdsPanel />} />
        <Route path="ads-report" element={<AdsFleetReport />} />
        <Route path="display" element={<DisplaySettingsPanel />} />
        <Route path="campaigns" element={<CampaignsPanel adminMode />} />
        <Route path="pricing" element={<PricingPanel />} />
        <Route path="house-ads" element={<HouseAdsPanel />} />
        <Route path="media" element={<MediaBrowserPanel />} />
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
