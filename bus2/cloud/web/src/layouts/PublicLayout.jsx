import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { APP_NAME } from '../lib/brand.js';

export default function PublicLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="public-layout">
      <nav className="public-nav">
        <Link to="/" className="public-nav-brand">
          <span>🌴</span> {APP_NAME}
        </Link>
        <div className="public-nav-links">
          {user ? (
            <>
              <Link to={user.role === 'admin' ? '/admin' : user.role === 'bus_owner' ? '/owner' : user.role === 'advertiser' ? '/advertiser' : '/driver'} className="btn btn-outline btn-sm">
                Dashboard
              </Link>
              <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-outline btn-sm">
                Log in
              </Link>
              <Link to="/signup" className="btn btn-primary btn-sm">
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        <p>© {new Date().getFullYear()} {APP_NAME} — Kerala bus route display & tourism advertising</p>
      </footer>
    </div>
  );
}
