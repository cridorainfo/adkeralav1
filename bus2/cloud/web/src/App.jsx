import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import NotFound from './pages/NotFound.jsx';
import AdminApp from './dashboards/admin/AdminApp.jsx';
import OwnerApp from './dashboards/owner/OwnerApp.jsx';
import AdvertiserApp from './dashboards/advertiser/AdvertiserApp.jsx';
import DriverApp from './dashboards/driver/DriverApp.jsx';
import DriverConnect from './pages/DriverConnect.jsx';
import DriverControl from './pages/DriverControl.jsx';
import DriverGpsTest from './pages/DriverGpsTest.jsx';
import { useAuth } from './lib/auth.jsx';
import { GuestOnly } from './lib/GuestOnly.jsx';
import { dashboardPathForRole } from './lib/brand.js';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="store-loading">
        <p>Loading…</p>
      </div>
    );
  }
  if (user && !user.legacy) {
    return <Navigate to={dashboardPathForRole(user.role)} replace />;
  }
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route index element={<HomeRedirect />} />
      <Route path="site" element={<Landing />} />
      <Route
        path="login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="signup"
        element={
          <GuestOnly>
            <Signup />
          </GuestOnly>
        }
      />
      <Route path="admin/*" element={<AdminApp />} />
      <Route path="owner/*" element={<OwnerApp />} />
      <Route path="advertiser/*" element={<AdvertiserApp />} />
      <Route path="driver" element={<DriverConnect />} />
      <Route path="driver/control" element={<DriverControl />} />
      <Route path="driver/gps-test" element={<DriverGpsTest />} />
      <Route path="driver/portal/*" element={<DriverApp />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
