import { Navigate, Route, Routes } from 'react-router-dom';
import PublicLayout from './layouts/PublicLayout.jsx';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import NotFound from './pages/NotFound.jsx';
import AdminApp from './dashboards/admin/AdminApp.jsx';
import OwnerApp from './dashboards/owner/OwnerApp.jsx';
import AdvertiserApp from './dashboards/advertiser/AdvertiserApp.jsx';
import DriverApp from './dashboards/driver/DriverApp.jsx';
import { useAuth } from './lib/auth.jsx';
import { dashboardPathForRole } from './lib/brand.js';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user && !user.legacy) {
    return <Navigate to={dashboardPathForRole(user.role)} replace />;
  }
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<HomeRedirect />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
      </Route>
      <Route path="admin/*" element={<AdminApp />} />
      <Route path="owner/*" element={<OwnerApp />} />
      <Route path="advertiser/*" element={<AdvertiserApp />} />
      <Route path="driver/*" element={<DriverApp />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
