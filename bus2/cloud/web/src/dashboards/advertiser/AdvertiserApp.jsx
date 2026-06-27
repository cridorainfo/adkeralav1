import { Routes, Route } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import { RequireAuth } from '../../lib/auth.jsx';
import CampaignsPanel from '../../components/CampaignsPanel.jsx';

const NAV = [{ to: '', label: 'Campaigns', end: true }];

export default function AdvertiserApp() {
  return (
    <RequireAuth roles={['advertiser']}>
      <DashboardLayout basePath="/advertiser" navItems={NAV} title="Advertiser portal">
        <Routes>
          <Route index element={<CampaignsPanel />} />
        </Routes>
      </DashboardLayout>
    </RequireAuth>
  );
}
