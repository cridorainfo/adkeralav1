import { Link } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME, APP_TAGLINE } from '../lib/brand.js';

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-layout">
      <aside className="auth-layout-brand">
        <Link to="/" className="auth-layout-logo">
          <AdKeralaLogo className="auth-layout-logo-icon" size="md" />
          <span>{APP_NAME}</span>
        </Link>
        <p className="auth-layout-tagline">{APP_TAGLINE}</p>
        <ul className="auth-layout-points">
          <li>Bilingual passenger displays</li>
          <li>Live fleet map & GPS tracking</li>
          <li>Route, stop & voice management</li>
          <li>Tourism ads on every bus</li>
        </ul>
        <Link to="/" className="auth-layout-back">
          ← Back to home
        </Link>
      </aside>
      <div className="auth-layout-form">
        <div className="auth-card auth-card-wide">
          <h1>{title}</h1>
          {subtitle && <p className="sub">{subtitle}</p>}
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}
