import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { APP_NAME, ROLE_LABELS } from '../lib/brand.js';

export default function DashboardLayout({ basePath, navItems, title, children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setNavOpen(false);
    };

    document.body.classList.add('dashboard-nav-open');
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.classList.remove('dashboard-nav-open');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [navOpen]);

  return (
    <div className={`dashboard-layout${navOpen ? ' dashboard-layout--nav-open' : ''}`}>
      <button
        type="button"
        className="dashboard-nav-backdrop"
        aria-label="Close menu"
        tabIndex={navOpen ? 0 : -1}
        onClick={() => setNavOpen(false)}
      />

      <aside className="dashboard-sidebar">
        <div className="dashboard-sidebar-brand">🌴 {APP_NAME}</div>
        <nav className="dashboard-nav" id="dashboard-sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={`${basePath}${item.to}`}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
              onClick={() => setNavOpen(false)}
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
          <button
            type="button"
            className="dashboard-menu-toggle"
            aria-expanded={navOpen}
            aria-controls="dashboard-sidebar-nav"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setNavOpen((open) => !open)}
          >
            <span className="dashboard-menu-toggle-bar" aria-hidden="true" />
            <span className="dashboard-menu-toggle-bar" aria-hidden="true" />
            <span className="dashboard-menu-toggle-bar" aria-hidden="true" />
          </button>
          <h1>{title}</h1>
        </div>
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
