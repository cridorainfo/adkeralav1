import { Link } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../lib/brand.js';

export default function Landing() {
  return (
    <>
      <section className="landing-hero">
        <div className="landing-hero-logo">🌴</div>
        <h1>{APP_NAME}</h1>
        <p>{APP_TAGLINE}</p>
        <p>Bilingual passenger displays, GPS auto-drive, tourism ads, and cloud fleet management for Kerala buses.</p>
        <div className="landing-hero-actions">
          <Link to="/signup" className="btn btn-gold">
            Get started
          </Link>
          <Link to="/login" className="btn btn-outline" style={{ borderColor: '#fff', color: '#fff' }}>
            Log in
          </Link>
        </div>
      </section>

      <section className="landing-section">
        <h2>Built for everyone on the road</h2>
        <div className="audience-grid">
          <div className="audience-card">
            <div className="audience-card-icon">🚌</div>
            <h3>Bus owners</h3>
            <p>Register your fleet, manage routes and stops, set pairing codes, and push ads to your buses.</p>
            <Link to="/signup?role=bus_owner" className="btn btn-primary btn-sm">
              Sign up as owner
            </Link>
          </div>
          <div className="audience-card">
            <div className="audience-card-icon">📱</div>
            <h3>Drivers</h3>
            <p>Pair with your bus using the plate or 4-digit code, then control routes over bus Wi‑Fi.</p>
            <Link to="/signup?role=driver" className="btn btn-primary btn-sm">
              Driver account
            </Link>
          </div>
          <div className="audience-card">
            <div className="audience-card-icon">📢</div>
            <h3>Advertisers</h3>
            <p>Create tourism ad campaigns for fullscreen displays and banner strips on Kerala buses.</p>
            <Link to="/signup?role=advertiser" className="btn btn-primary btn-sm">
              Advertise with us
            </Link>
          </div>
          <div className="audience-card">
            <div className="audience-card-icon">☁️</div>
            <h3>Fleet admins</h3>
            <p>Platform operators manage the full fleet map, route catalog, content gaps, and releases.</p>
            <Link to="/login" className="btn btn-secondary btn-sm">
              Admin login
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <h2>Features</h2>
        <div className="features-grid">
          <div className="feature-pill">English + Malayalam stop names</div>
          <div className="feature-pill">GPS auto-forward at stops</div>
          <div className="feature-pill">1920×1080 tourism ads + banner strip</div>
          <div className="feature-pill">Stop voice announcements</div>
          <div className="feature-pill">Live fleet map & telemetry</div>
          <div className="feature-pill">Local-first bus PC + cloud sync</div>
        </div>
      </section>
    </>
  );
}
