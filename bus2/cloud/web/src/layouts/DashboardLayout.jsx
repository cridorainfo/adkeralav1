import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { APP_NAME, ROLE_LABELS } from '../lib/brand.js';

export default function DashboardLayout({ basePath, navItems, title, children }) {
  const { user, logout } = useAuth();

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-brand">🌴 {APP_NAME}</div>
        <nav className="dashboard-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={`${basePath}${item.to}`}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="dashboard-sidebar-footer">
          <div>{user?.name}</div>
          <div>{ROLE_LABELS[user?.role] ?? user?.role}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={logout}>
            Log out
          </button>
          <Link to="/" style={{ display: 'block', marginTop: '0.5rem', opacity: 0.8 }}>
            ← Public site
          </Link>
        </div>
      </aside>
      <div className="dashboard-main">
        <div className="dashboard-header">
          <h1>{title}</h1>
        </div>
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
