import { Link } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../lib/brand';
import DriverConnectBanner from '../components/DriverConnectBanner';
import { useNetworkUrls } from '../hooks/useNetworkUrls';

export default function Home() {
  const network = useNetworkUrls();
  const adminUrl = network?.adminUrl ?? null;
  const adminKeyHint = network?.adminKeyHint ?? null;

  return (
    <div className="home">
      <div className="home-brand">
        <div className="home-logo">🌴</div>
        <h1>{APP_NAME}</h1>
        <p className="home-tagline">{APP_TAGLINE}</p>
      </div>

      <DriverConnectBanner />

      <div className="home-cards">
        <div className="home-card">
          <span className="home-card-icon">📱</span>
          <h2>Driver app — Pair &amp; control</h2>
          <p>
            Enter the plate or 4-digit code from the bus display, then open control over bus Wi‑Fi.
          </p>
          <Link to="/driver" className="home-card-btn control">
            Open Driver connect →
          </Link>
        </div>

        <div className="home-card">
          <span className="home-card-icon">🎛️</span>
          <h2>Control — Driver Phone</h2>
          <p>
            Routes, drive controls, and settings. Open on the driver&apos;s phone while the bus PC
            runs the passenger display.
          </p>
          <Link to="/control" className="home-card-btn control">
            Open Control →
          </Link>
        </div>

        <div className="home-card">
          <span className="home-card-icon">📺</span>
          <h2>Display — Bus PC</h2>
          <p>
            Passenger-facing screen: current stop, next stop, destination, and tourism ads with
            audio.
          </p>
          <Link to="/display" className="home-card-btn display">
            Open Display →
          </Link>
        </div>

        {adminUrl && (
          <div className="home-card">
            <span className="home-card-icon">☁️</span>
            <h2>Admin — Fleet Dashboard</h2>
            <p>
              Fleet map, live bus telemetry, ads, route catalog, and content gaps. Runs locally with
              the bus server.
              {adminKeyHint && (
                <>
                  {' '}
                  Default API key: <code>{adminKeyHint}</code>
                </>
              )}
            </p>
            <a href={adminUrl} className="home-card-btn admin" target="_blank" rel="noopener noreferrer">
              Open Admin →
            </a>
          </div>
        )}
      </div>

      <p className="home-hint">
        Bus PC: open <strong>/display</strong> (fullscreen). Driver phone: open{' '}
        <strong>/control</strong> on the same Wi‑Fi.
        {adminUrl && (
          <>
            {' '}
            Admin dashboard: <a href={adminUrl}>{adminUrl}</a>
          </>
        )}
      </p>
    </div>
  );
}
