import { Link } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../lib/brand';
import DriverConnectBanner from '../components/DriverConnectBanner';

export default function Home() {
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
      </div>

      <p className="home-hint">
        Bus PC: open <strong>/display</strong> (fullscreen). Driver phone: open{' '}
        <strong>/control</strong> on the same Wi‑Fi. Changes sync every few seconds via the bus
        server.
      </p>
    </div>
  );
}
