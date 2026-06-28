import { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import DashboardLayout from '../../layouts/DashboardLayout.jsx';
import { RequireAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';

const NAV = [{ to: '', label: 'My bus', end: true }];

function DriverHome() {
  const [session, setSession] = useState(null);
  const [driverId, setDriverId] = useState(localStorage.getItem('adkerala-driver-id') ?? '');
  const [message, setMessage] = useState('');

  async function load() {
    try {
      const json = await api('/api/driver/account');
      setSession(json);
    } catch (err) {
      setMessage(err.message);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function linkAccount() {
    if (!driverId.trim()) return;
    localStorage.setItem('adkerala-driver-id', driverId.trim());
    await api('/api/driver/link-account', {
      method: 'POST',
      body: JSON.stringify({ driverId: driverId.trim() }),
    });
    setMessage('Account linked');
    load();
  }

  return (
    <div className="card">
      <h2>Driver dashboard</h2>
      <p className="hint">
        Pair with your bus using the driver app on the bus Wi‑Fi (plate or 4-digit code). Then link your pairing session here.
      </p>

      <div className="form-group">
        <label>Driver session ID (from driver app)</label>
        <input value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="UUID from driver app" />
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={linkAccount}>
        Link to account
      </button>
      {message && <p className="hint">{message}</p>}

      {session?.linked ? (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Linked bus: {session.busId}</h3>
          <p>
            <span className={`status-dot ${session.online ? 'online' : 'offline'}`} />
            {session.online ? 'Online' : 'Offline'}
          </p>
          {session.profile && (
            <p className="hint">
              Plate: {session.profile.plateDisplay || session.profile.plate || '—'} · Code: {session.profile.pairingCode}
            </p>
          )}
          {session.telemetry && (
            <div className="display-mirror" style={{ marginTop: '1rem' }}>
              <h3>{session.telemetry.routeName ?? '—'}</h3>
              <div>Current: <strong>{session.telemetry.currentStopEn ?? '—'}</strong></div>
              <div className="next">Next: <strong>{session.telemetry.nextStopEn ?? '—'}</strong></div>
            </div>
          )}
        </>
      ) : (
        <p className="empty-state" style={{ marginTop: '1.5rem' }}>
          Not linked yet. Open the driver app on the bus, pair with plate/code, then paste your driver session ID above.
        </p>
      )}
    </div>
  );
}

export default function DriverApp() {
  return (
    <RequireAuth roles={['driver']}>
      <DashboardLayout basePath="/driver/portal" navItems={NAV} title="Driver portal">
        <Routes>
          <Route index element={<DriverHome />} />
        </Routes>
      </DashboardLayout>
    </RequireAuth>
  );
}
