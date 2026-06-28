import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../lib/brand.js';
import {
  controlUrlForSession,
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  pairDriver,
  sendDriverHeartbeat,
  setCloudUrl,
  unlinkDriver,
} from '../lib/driverPhone.js';
import { useDriverGps } from '../hooks/useDriverGps.js';
import { useDriverCloudLocation } from '../hooks/useDriverCloudLocation.js';
import DriverBusInfo from '../components/DriverBusInfo.jsx';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Public mobile driver page — pair with bus, send live GPS. No login. */
export default function DriverConnect() {
  const [driverId, setDriverId] = useState('');
  const [cloudUrl, setCloudUrlState] = useState('');
  const [session, setSession] = useState(null);
  const [plateOrCode, setPlateOrCode] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const linked = Boolean(session?.linked);

  const { location, permission, requestGps } = useDriverGps(linked);
  useDriverCloudLocation({ enabled: linked, location, linked, driverId });

  useEffect(() => {
    const id = ensureDriverId();
    const url = loadCloudUrl();
    setDriverId(id);
    setCloudUrlState(url);
    setReady(true);
  }, []);

  const refreshSession = useCallback(async () => {
    if (!driverId) return null;
    const url = loadCloudUrl();
    try {
      const json = await fetchDriverSession(driverId, url);
      if (!json.ok && !json.linked) {
        setStatus(json.error ?? 'Could not reach cloud');
        setStatusError(true);
        setSession(null);
        return null;
      }
      setSession(json);
      setStatusError(false);
      if (json.linked) {
        setStatus(json.online ? 'Linked — bus online' : 'Linked — waiting for bus Wi‑Fi');
      } else {
        setStatus('Enter plate or 4-digit code from the bus display');
      }
      return json;
    } catch {
      setStatus('Cloud unreachable. Check network.');
      setSession(null);
      return null;
    }
  }, [driverId]);

  useEffect(() => {
    if (!ready || !driverId) return undefined;
    refreshSession();
    sendDriverHeartbeat(driverId, cloudUrl).catch(() => {});
    const id = setInterval(() => {
      refreshSession();
      sendDriverHeartbeat(driverId, cloudUrl).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [ready, driverId, refreshSession, cloudUrl]);

  const handlePair = async (e) => {
    e.preventDefault();
    if (!plateOrCode.trim() || !driverId) return;
    setBusy(true);
    setStatus('Pairing…');
    setStatusError(false);
    try {
      const json = await pairDriver(driverId, plateOrCode, cloudUrl);
      if (!json.ok) {
        setStatus(json.error ?? 'Pair failed');
        setStatusError(true);
        return;
      }
      setStatusError(false);
      setSession({ linked: true, ...json });
      setStatus('Linked — finding bus on Wi‑Fi…');
      for (let i = 0; i < 12; i += 1) {
        const next = await fetchDriverSession(driverId, cloudUrl);
        if (next?.linked && next.lanIp) {
          setSession(next);
          const controlUrl = controlUrlForSession(next);
          if (controlUrl) {
            window.location.href = controlUrl;
            return;
          }
        }
        await sleep(2000);
      }
      await refreshSession();
      setStatus('Linked — tap Open control when on bus Wi‑Fi');
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    if (!driverId) return;
    setBusy(true);
    try {
      const json = await unlinkDriver(driverId, cloudUrl);
      setStatus(json.ok ? 'Unlinked' : (json.error ?? 'Unlink failed'));
      await refreshSession();
    } finally {
      setBusy(false);
    }
  };

  const openControl = () => {
    const url = controlUrlForSession(session);
    if (url) window.location.href = url;
    else setStatus('Bus LAN address not available yet. Stay on bus Wi‑Fi.');
  };

  const controlReady = linked && session?.lanIp;
  const gpsOk = location?.lat != null && !location?.error;

  return (
    <div className="driver-connect-page">
      <div className="driver-connect-card">
        <div className="driver-connect-header">
          <span className="driver-connect-logo">🌴</span>
          <h1>{APP_NAME} Driver</h1>
          <p>Pair with your bus — no account login needed.</p>
        </div>

        <p className={`driver-connect-status${statusError ? ' driver-connect-status-error' : ''}`} role="status">
          {status}
        </p>

        {linked ? (
          <div className="driver-connect-section">
            <DriverBusInfo session={session} />
            {session.lanIp && (
              <p>
                <strong>LAN:</strong> {session.lanIp}:{session.controlPort ?? 5174}
              </p>
            )}
            {gpsOk ? (
              <p className="hint">
                GPS: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </p>
            ) : (
              <p className="hint">
                {permission === 'denied' ? 'Location blocked — enable in phone settings.' : 'Waiting for GPS…'}
                {permission !== 'granted' && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={requestGps} style={{ marginLeft: 8 }}>
                    Enable location
                  </button>
                )}
              </p>
            )}
            <div className="driver-connect-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!controlReady || busy}
                onClick={openControl}
              >
                Open control
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={handleUnlink}>
                Unlink
              </button>
            </div>
            <p className="driver-connect-foot">Live GPS is sent to the fleet map while this page is open.</p>
          </div>
        ) : (
          <form className="driver-connect-section" onSubmit={handlePair}>
            <label htmlFor="plateOrCode">4-digit pairing code (on bus display)</label>
            <input
              id="plateOrCode"
              type="text"
              autoComplete="off"
              inputMode="numeric"
              maxLength={12}
              placeholder="e.g. 7291 — not the 6-digit fleet code"
              value={plateOrCode}
              onChange={(e) => setPlateOrCode(e.target.value)}
              disabled={busy || !ready}
            />
            <p className="hint" style={{ margin: 0 }}>
              Or enter the full number plate (e.g. KL07AB1234). Bus must be online in Fleet first.
            </p>
            <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
              Connect to bus
            </button>
          </form>
        )}

        <p className="driver-connect-foot">
          {driverId ? (
            <>
              Device ID: <code>{driverId.slice(0, 8)}…</code>
            </>
          ) : (
            'Preparing device…'
          )}
          {cloudUrl && (
            <>
              {' · '}
              Cloud: <code>{cloudUrl.replace(/^https?:\/\//, '')}</code>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
