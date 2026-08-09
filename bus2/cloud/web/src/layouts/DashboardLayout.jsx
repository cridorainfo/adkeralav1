import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Bus,
  QrCode,
  Radio,
  LayoutGrid,
  Map,
  MapPin,
  Mic,
  Megaphone,
  BarChart3,
  MonitorCog,
  Target,
  CalendarClock,
  Tag,
  Home,
  FolderOpen,
  AlertTriangle,
  BookOpen,
  Users,
  PackageCheck,
  Circle,
  Menu,
  X,
  LogOut,
} from 'lucide-react';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { useAuth } from '../lib/auth.jsx';
import { APP_NAME, ROLE_LABELS } from '../lib/brand.js';

// Label -> icon lookup, keyed by the exact nav label strings already used in each dashboard's
// own NAV array (AdminApp.jsx/OwnerApp.jsx/AdvertiserApp.jsx/DriverApp.jsx) — kept here rather
// than adding an `icon` field to those arrays, so nav restructuring stays a separate, later
// decision and this pass only touches this one shared shell file. Falls back to a plain dot for
// any label not listed (defensive, not expected to trigger with the current 4 dashboards).
const NAV_ICON_MAP = {
  Fleet: Bus,
  'My fleet': Bus,
  'My bus': Bus,
  'Claim bus': QrCode,
  'Live bus': Radio,
  'Live Wall': LayoutGrid,
  Routes: Map,
  Stops: MapPin,
  Voices: Mic,
  Ads: Megaphone,
  'Ads Report': BarChart3,
  Display: MonitorCog,
  Campaigns: Target,
  Schedules: CalendarClock,
  Pricing: Tag,
  'House ads': Home,
  'Media browser': FolderOpen,
  'Content gaps': AlertTriangle,
  'Route catalog': BookOpen,
  Users,
  Releases: PackageCheck,
};

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
        <div className="dashboard-sidebar-brand">
          <AdKeralaLogo size="sm" />
          {APP_NAME}
        </div>
        <nav className="dashboard-nav" id="dashboard-sidebar-nav">
          {navItems.map((item) => {
            const Icon = NAV_ICON_MAP[item.label] ?? Circle;
            return (
              <NavLink
                key={item.to}
                to={`${basePath}${item.to}`}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={17} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="dashboard-sidebar-footer">
          <div>{user?.name}</div>
          <div>{ROLE_LABELS[user?.role] ?? user?.role}</div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={logout}>
            <LogOut size={15} aria-hidden="true" />
            Log out
          </button>
          <Link to="/site" style={{ display: 'block', marginTop: '0.5rem', opacity: 0.8 }}>
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
            {navOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
          <h1>{title}</h1>
        </div>
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
