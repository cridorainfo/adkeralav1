import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { dashboardPathForRole } from './brand.js';

export function GuestOnly({ children }) {
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

  return children;
}
