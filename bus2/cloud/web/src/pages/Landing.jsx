import { Link } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME, APP_TAGLINE } from '../lib/brand.js';

const FEATURES = [
  { icon: '🌐', title: 'Bilingual stops', desc: 'English & Malayalam on every passenger screen' },
  { icon: '📍', title: 'GPS auto-drive', desc: 'Auto-forward at stops when the driver phone shares location' },
  { icon: '📢', title: 'Tourism ads', desc: 'Fullscreen 1920×1080 promos plus 728×90 banner strip' },
  { icon: '🔊', title: 'Voice announcements', desc: 'Stop names and route phrases with recorded audio' },
  { icon: '🗺️', title: 'Cloud fleet map', desc: 'Track all buses live from one admin dashboard' },
  { icon: '💾', title: 'Local-first sync', desc: 'Bus PC works offline; cloud queues updates when online' },
];

const ROLES = [
  {
    icon: '🚌',
    title: 'Bus owners',
    desc: 'Register buses, edit routes, set pairing codes, and push ads to your fleet.',
    cta: 'Sign up as owner',
    to: '/signup?role=bus_owner',
    primary: true,
  },
  {
    icon: '📱',
    title: 'Drivers',
    desc: 'Pair with plate or 4-digit code, then control the route over bus Wi‑Fi.',
    cta: 'Driver account',
    to: '/signup?role=driver',
    primary: true,
  },
  {
    icon: '📣',
    title: 'Advertisers',
    desc: 'Run campaigns on Kerala buses — fullscreen and banner placements.',
    cta: 'Advertise with us',
    to: '/signup?role=advertiser',
    primary: true,
  },
  {
    icon: '☁️',
    title: 'Platform admin',
    desc: 'Manage the full fleet, users, routes, releases, and content catalog.',
    cta: 'Admin login',
    to: '/login',
    primary: false,
  },
];

const STEPS = [
  { n: '1', title: 'Install on bus PC', desc: 'Passenger display runs fullscreen; syncs over LAN & cloud.' },
  { n: '2', title: 'Register in cloud', desc: 'Add bus ID, plate, and pairing code in the admin dashboard.' },
  { n: '3', title: 'Driver pairs', desc: 'Phone connects via plate or code, then opens Control on Wi‑Fi.' },
  { n: '4', title: 'Manage remotely', desc: 'Push routes, stops, voices, and ads from anywhere.' },
];

export default function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <Link to="/" className="landing-logo">
            <AdKeralaLogo size="sm" />
            {APP_NAME}
          </Link>
          <nav className="landing-nav">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#roles">Get started</a>
          </nav>
          <div className="landing-header-actions">
            <Link to="/login" className="btn btn-outline btn-sm">
              Log in
            </Link>
            <Link to="/signup" className="btn btn-primary btn-sm">
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-inner">
          <div className="landing-hero-content">
            <p className="landing-eyebrow">God&apos;s Own Country · Smart bus platform</p>
            <h1>
              Route display, ads &amp; fleet control for <span>Kerala buses</span>
            </h1>
            <p className="landing-hero-lead">
              {APP_TAGLINE}. One platform for passenger screens, driver control, cloud admin, and tourism advertising.
            </p>
            <div className="landing-hero-actions">
              <Link to="/signup" className="btn btn-gold btn-lg">
                Create free account
              </Link>
              <Link to="/login" className="btn btn-hero-outline btn-lg">
                Log in
              </Link>
            </div>
            <p className="landing-hero-note">
              Platform admin? <Link to="/login">Sign in to the admin dashboard →</Link>
            </p>
          </div>
          <div className="landing-hero-visual">
            <div className="landing-mock-display">
              <div className="landing-mock-bar">🚌 Route view</div>
              <div className="landing-mock-body">
                <p className="landing-mock-label">Next stop</p>
                <h3>എറണാകുളം · Ernakulam</h3>
                <p className="landing-mock-sub">Then → Alappuzha / ആലപ്പുഴ</p>
              </div>
              <div className="landing-mock-banner">Tourism ad · 728×90 banner</div>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-stats">
        <div className="landing-stats-inner">
          <div className="landing-stat">
            <strong>2</strong>
            <span>Languages</span>
          </div>
          <div className="landing-stat">
            <strong>5s</strong>
            <span>Cloud sync</span>
          </div>
          <div className="landing-stat">
            <strong>4</strong>
            <span>User roles</span>
          </div>
          <div className="landing-stat">
            <strong>24/7</strong>
            <span>Fleet visibility</span>
          </div>
        </div>
      </section>

      <section id="features" className="landing-section">
        <p className="landing-section-eyebrow">Features</p>
        <h2>Everything a modern Kerala bus needs</h2>
        <div className="landing-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="landing-feature">
              <span className="landing-feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="landing-section landing-section-alt">
        <p className="landing-section-eyebrow">How it works</p>
        <h2>From bus PC to cloud in four steps</h2>
        <div className="landing-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="landing-step">
              <span className="landing-step-num">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="roles" className="landing-section">
        <p className="landing-section-eyebrow">Get started</p>
        <h2>Choose your role</h2>
        <div className="landing-roles">
          {ROLES.map((r) => (
            <article key={r.title} className="landing-role-card">
              <span className="landing-role-icon">{r.icon}</span>
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
              <Link to={r.to} className={`btn btn-sm ${r.primary ? 'btn-primary' : 'btn-secondary'}`}>
                {r.cta}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-inner">
          <h2>Ready to modernize your fleet?</h2>
          <p>Join bus owners, drivers, and advertisers on AdKerala today.</p>
          <div className="landing-hero-actions">
            <Link to="/signup" className="btn btn-gold btn-lg">
              Sign up free
            </Link>
            <Link to="/login" className="btn btn-hero-outline btn-lg">
              Log in
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-footer-brand">
            <span className="landing-footer-brand-row">
              <AdKeralaLogo size="sm" />
              {APP_NAME}
            </span>
            <p>Kerala bus route display &amp; tourism advertising</p>
          </div>
          <div className="landing-footer-links">
            <Link to="/login">Log in</Link>
            <Link to="/signup">Sign up</Link>
            <Link to="/login">Admin dashboard</Link>
          </div>
          <p className="landing-footer-copy">© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
