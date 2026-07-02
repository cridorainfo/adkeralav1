import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME } from '../lib/brand.js';
import {
  clearLanLink,
  controlUrlForSession,
  ensureDriverId,
  fetchDriverSession,
  fullControlUrlForSession,
  lanLinkForDriver,
  loadCloudUrl,
  loadLanLink,
  pairDriver,
  saveLanLink,
  sendDriverHeartbeat,
  unlinkDriver,
  unlockLanWithDriverId,
} from '../lib/driverPhone.js';
import { readPairCodeFromLocation } from '../lib/driverPairing.js';
import { useDriverGps } from '../hooks/useDriverGps.js';
import { useDriverCloudLocation } from '../hooks/useDriverCloudLocation.js';
import DriverBusInfo from '../components/DriverBusInfo.jsx';
import DriverRemoteControl from '../components/DriverRemoteControl.jsx';
import DriverInstallPrompt from '../components/DriverInstallPrompt.jsx';
import DriverQrScanner from '../components/DriverQrScanner.jsx';

/** PWA driver — scan QR, stay linked until disconnect, drive via cloud or bus Wi‑Fi. */
export default function DriverConnect() {
  const location = useLocation();
  const navigate = useNavigate();
  const [driverId, setDriverId] = useState('');
  const [cloudUrl, setCloudUrlState] = useState('');
  const [session, setSession] = useState(null);
  const [plateOrCode, setPlateOrCode] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const linked = Boolean(session?.linked);
  const offlineLinked = Boolean(session?.offline && session?.linked);

  const persistLanLink = useCallback(
    (json, extra = {}) => {
      if (!driverId || !json?.linked) return;
      saveLanLink({
        driverId,
        busId: json.busId ?? extra.busId,
        lanIp: json.lanIp ?? extra.lanIp,
        controlPort: json.controlPort ?? extra.controlPort ?? 5174,
        pairingCode: json.pairingCode ?? extra.pairingCode,
        plate: json.plate ?? extra.plate ?? '',
        linkedAt: json.linkedAt ?? extra.linkedAt ?? Date.now(),
      });
    },
    [driverId]
  );

  const sessionFromCache = useCallback(() => {
    const cached = lanLinkForDriver(driverId);
    if (!cached?.lanIp) return null;
    return {
      ...cached,
      linked: true,
      offline: true,
      online: false,
    };
  }, [driverId]);

  const { location: gpsLocation, permission, requestGps, trackingMode } = useDriverGps(ready);
  useDriverCloudLocation({ enabled: linked, location: gpsLocation, linked, driverId });

  useEffect(() => {
    const id = ensureDriverId();
    const url = loadCloudUrl();
    setDriverId(id);
    setCloudUrlState(url);
    setReady(true);

    const fromUrl = readPairCodeFromLocation(location.search);
    if (fromUrl) setPlateOrCode(fromUrl);

    const cached = lanLinkForDriver(id);
    if (cached?.lanIp) {
      setSession({
        ...cached,
        linked: true,
        offline: true,
        online: false,
      });
    }
  }, [location.search]);

  const refreshSession = useCallback(async () => {
    if (!driverId) return null;
    const url = loadCloudUrl();
    try {
      const json = await fetchDriverSession(driverId, url);
      if (!json.ok && !json.linked) {
        const cached = sessionFromCache();
        if (cached) {
          setSession(cached);
          setStatus('Offline — open bus control on bus Wi‑Fi (saved link)');
          setStatusError(false);
          return cached;
        }
        setStatus(json.error ?? 'Could not reach cloud');
        setStatusError(true);
        setSession(null);
        return null;
      }
      if (!json.linked) {
        clearLanLink();
      } else {
        persistLanLink(json);
      }
      setSession(json);
      setStatusError(false);
      if (json.linked) {
        setStatus(json.online ? 'Connected — bus online' : 'Connected — open bus control on Wi‑Fi');
      } else {
        setStatus('Scan the bus QR or enter the pair code below');
      }
      return json;
    } catch {
      const cached = sessionFromCache();
      if (cached) {
        setSession(cached);
        setStatus('Offline — bus control works on bus Wi‑Fi (saved credentials)');
        setStatusError(false);
        return cached;
      }
      setStatus('Cloud unreachable. Join bus Wi‑Fi and open saved bus control.');
      setSession(null);
      setStatusError(true);
      return null;
    }
  }, [driverId, persistLanLink, sessionFromCache]);

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

  const runPair = useCallback(
    async (code) => {
      const value = String(code ?? plateOrCode ?? '').trim();
      if (!value || !driverId) return false;
      setBusy(true);
      setStatus('Connecting to bus…');
      setStatusError(false);
      try {
        const json = await pairDriver(driverId, value, cloudUrl);
        if (!json.ok) {
          setStatus(json.error ?? 'Could not connect');
          setStatusError(true);
          return false;
        }
        persistLanLink({ linked: true, ...json }, json);
        await refreshSession();
        setStatus('Connected — ready to drive');
        setPlateOrCode('');
        if (location.search) navigate('/driver', { replace: true });
        return true;
      } finally {
        setBusy(false);
      }
    },
    [plateOrCode, driverId, cloudUrl, refreshSession, location.search, navigate, persistLanLink]
  );

  useEffect(() => {
    if (!ready || !driverId || linked) return;
    const fromUrl = readPairCodeFromLocation(location.search);
    if (fromUrl && fromUrl.length >= 4) runPair(fromUrl);
  }, [ready, driverId, linked, location.search, runPair]);

  const handlePair = (e) => {
    e.preventDefault();
    runPair(plateOrCode);
  };

  const handleScanResult = (code) => {
    setPlateOrCode(code);
    runPair(code);
  };

  const handleDisconnect = async () => {
    if (!driverId) return;
    if (!window.confirm('Disconnect from this bus? The display will show the QR code again.')) return;
    setBusy(true);
    try {
      const json = await unlinkDriver(driverId, cloudUrl);
      if (json.ok) clearLanLink();
      setStatus(json.ok ? 'Disconnected' : (json.error ?? 'Disconnect failed'));
      setStatusError(!json.ok);
      await refreshSession();
    } finally {
      setBusy(false);
    }
  };

  const openFullControl = async () => {
    const active = session ?? sessionFromCache();
    if (!active?.lanIp) {
      setStatus('Join the bus Wi‑Fi first — full control needs the local network.');
      setStatusError(false);
      return;
    }
    setBusy(true);
    setStatus('Opening bus control…');
    try {
      const unlocked = await unlockLanWithDriverId(driverId, active);
      const url = fullControlUrlForSession(active, driverId);
      if (url) {
        window.location.href = url;
        return;
      }
      setStatus(unlocked.error ?? 'Could not open bus control');
      setStatusError(true);
    } finally {
      setBusy(false);
    }
  };

  const controlReady = linked && (session?.lanIp || loadLanLink()?.lanIp);
  const gpsOk = gpsLocation?.lat != null && !gpsLocation?.error;

  return (
    <div className="driver-connect-page">
      <DriverQrScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanResult}
      />

      <div className="driver-connect-card driver-connect-card-wide">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} Driver</h1>
          <p>{linked ? 'You are connected to this bus' : 'Scan the QR on the bus display to start'}</p>
        </div>

        <p
          className={`driver-connect-status${statusError ? ' driver-connect-status-error' : ''}`}
          role="status"
        >
          {status}
        </p>

        <DriverInstallPrompt linked={linked} />

        {linked ? (
          <>
            <DriverBusInfo session={session} />

            <DriverRemoteControl
              driverId={driverId}
              session={session}
              onDriveMessage={(msg) => {
                if (msg && !msg.startsWith('Queued')) setStatusError(true);
              }}
            />

            <div className="driver-connect-section driver-connect-extras">
              <h3 className="driver-section-subtitle">Location</h3>
              {gpsOk ? (
                <p className="hint">
                  GPS: {gpsLocation.lat.toFixed(5)}, {gpsLocation.lng.toFixed(5)}
                </p>
              ) : (
                <p className="hint">
                  {permission === 'denied'
                    ? 'Location blocked — allow location in phone settings.'
                    : 'Waiting for GPS…'}
                  {permission !== 'granted' && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm driver-inline-btn"
                      onClick={requestGps}
                    >
                      Allow location
                    </button>
                  )}
                </p>
              )}
              <p className="hint">
                {trackingMode === 'background'
                  ? 'GPS runs in the installed app even when the screen is off.'
                  : 'Install the app for better background GPS on Android.'}
              </p>

              <div className="driver-connect-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!controlReady || busy}
                  onClick={openFullControl}
                >
                  {offlineLinked ? 'Bus control (offline Wi‑Fi)' : 'Full control (bus Wi‑Fi)'}
                </button>
              </div>
              {(session?.lanIp || loadLanLink()?.lanIp) && (
                <p className="driver-connect-foot">
                  {offlineLinked
                    ? 'No internet needed — saved link opens control on this bus Wi‑Fi until you disconnect.'
                    : 'On bus Wi‑Fi: routes, ESP32, and instant buttons — no OTP after cloud pair.'}
                </p>
              )}
            </div>

            <button
              type="button"
              className="btn btn-danger driver-disconnect-main"
              disabled={busy}
              onClick={handleDisconnect}
            >
              Disconnect from bus
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary driver-scan-btn"
              disabled={busy || !ready}
              onClick={() => setScannerOpen(true)}
            >
              <span className="driver-scan-icon" aria-hidden>
                📷
              </span>
              Scan bus QR code
            </button>

            <p className="driver-connect-or">or enter code manually</p>

            <form className="driver-connect-section" onSubmit={handlePair}>
              <label htmlFor="plateOrCode">4-digit code or number plate</label>
              <input
                id="plateOrCode"
                type="text"
                autoComplete="off"
                inputMode="text"
                maxLength={12}
                placeholder="e.g. 7291 or KL07AB1234"
                value={plateOrCode}
                onChange={(e) => setPlateOrCode(e.target.value)}
                disabled={busy || !ready}
              />
              <button type="submit" className="btn btn-secondary" disabled={busy || !ready || !plateOrCode.trim()}>
                Connect
              </button>
            </form>
          </>
        )}

        <p className="driver-connect-foot driver-connect-foot-muted">
          {driverId ? <>Device: {driverId.slice(0, 8)}…</> : 'Preparing…'}
          {linked && ' · Stays connected until you tap Disconnect · LAN saved on this phone'}
        </p>
      </div>
    </div>
  );
}
