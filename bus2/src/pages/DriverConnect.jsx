import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '../lib/brand';
import { APP_VERSION, isNewerVersion } from '../lib/version';
import {
  controlUrlForSession,
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  pairDriver,
  sendDriverHeartbeat,
  setCloudUrl,
  unlinkDriver,
} from '../lib/driverCloud';
import { downloadAndInstallApk } from '../lib/driverUpdate';
import { useBusStore } from '../hooks/useBusStore';
import { useDriverGps } from '../hooks/useDriverGps';
import { useDriverCloudLocation } from '../hooks/useDriverCloudLocation';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function DriverConnect() {
  const [driverId, setDriverId] = useState('');
  const [cloudUrl, setCloudUrlState] = useState('');
  const [cloudDraft, setCloudDraft] = useState('');
  const [session, setSession] = useState(null);
  const [plateOrCode, setPlateOrCode] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [busy, setBusy] = useState(false);
  const [needsCloudUrl, setNeedsCloudUrl] = useState(false);
  const [ready, setReady] = useState(false);
  const [driverUpdate, setDriverUpdate] = useState(null);
  const { state } = useBusStore();
  const linked = Boolean(session?.linked);

  useDriverGps(linked);
  useDriverCloudLocation({ enabled: linked, location: state.driverLocation, linked });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [id, url] = await Promise.all([ensureDriverId(), loadCloudUrl()]);
      if (cancelled) return;
      setDriverId(id);
      setCloudUrlState(url);
      setCloudDraft(url);
      setNeedsCloudUrl(!url);
      setReady(true);

      if (url) {
        try {
          const res = await fetch(`${url}/api/releases/driver/latest`);
          const json = await res.json();
          const latest = json?.release?.version;
          if (latest && isNewerVersion(latest, APP_VERSION)) {
            setDriverUpdate(json.release);
          } else if (json?.minVersion && isNewerVersion(json.minVersion, APP_VERSION)) {
            setDriverUpdate({ ...json.release, version: json.minVersion, required: true });
          }
        } catch {
          /* cloud offline */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSession = useCallback(async () => {
    if (!driverId) return null;
    const url = cloudUrl || (await loadCloudUrl());
    if (!url) {
      setNeedsCloudUrl(true);
      setStatus('Set your cloud URL to continue.');
      return null;
    }
    setNeedsCloudUrl(false);
    setCloudUrlState(url);
    try {
      const json = await fetchDriverSession(driverId, url);
      if (!json.ok && !json.linked) {
        setStatus(json.error ?? 'Could not reach cloud');
        setSession(null);
        return null;
      }
      setSession(json);
      if (json.linked) {
        setStatus(json.online ? 'Linked — bus online' : 'Linked — waiting for bus Wi‑Fi');
      } else {
        setStatus('Not linked — enter plate or code from the bus display');
      }
      return json;
    } catch {
      setStatus('Cloud unreachable. Check URL and network.');
      setSession(null);
      return null;
    }
  }, [driverId, cloudUrl]);

  useEffect(() => {
    if (!ready || !driverId) return undefined;
    refreshSession();
    sendDriverHeartbeat(driverId, APP_VERSION, cloudUrl).catch(() => {});
    const id = setInterval(() => {
      refreshSession();
      sendDriverHeartbeat(driverId, APP_VERSION, cloudUrl).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [ready, driverId, refreshSession, cloudUrl]);

  const saveCloudUrl = async () => {
    await setCloudUrl(cloudDraft);
    const url = cloudDraft.trim().replace(/\/$/, '');
    setCloudUrlState(url);
    setNeedsCloudUrl(false);
    refreshSession();
  };

  const handlePair = async (e) => {
    e.preventDefault();
    if (!plateOrCode.trim() || !driverId) return;
    if (driverUpdate?.required) {
      setStatus('Update required before pairing. Install the latest driver app.');
      return;
    }
    setBusy(true);
    setStatus('Pairing…');
    try {
      const json = await pairDriver(driverId, plateOrCode, cloudUrl);
      if (!json.ok) {
        setStatus(json.error ?? 'Pair failed');
        return;
      }
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

  return (
    <div className="driver-connect-page">
      <div className="driver-connect-card">
        <div className="driver-connect-header">
          <span className="driver-connect-logo">🌴</span>
          <h1>{APP_NAME} Driver</h1>
          <p>Pair with your bus, then open control over Wi‑Fi.</p>
          <p className="driver-connect-foot">App v{APP_VERSION}</p>
        </div>

        {driverUpdate?.downloadUrl && (
          <div className="driver-connect-section update-banner">
            <strong>
              {driverUpdate.required ? 'Update required' : 'Update available'} — v{driverUpdate.version}
            </strong>
            {driverUpdate.releaseNotes && <p>{driverUpdate.releaseNotes}</p>}
            <a
              className="btn primary"
              href={driverUpdate.downloadUrl}
              onClick={(e) => {
                if (window.Capacitor?.isNativePlatform?.()) {
                  e.preventDefault();
                  downloadAndInstallApk(driverUpdate.downloadUrl);
                }
              }}
              target="_blank"
              rel="noreferrer"
            >
              {driverUpdate.required ? 'Update required' : 'Download update'}
            </a>
          </div>
        )}

        {needsCloudUrl && !import.meta.env.VITE_CLOUD_URL && (
          <div className="driver-connect-section">
            <label htmlFor="cloudUrl">Cloud URL</label>
            <input
              id="cloudUrl"
              type="url"
              placeholder="https://your-app.up.railway.app"
              value={cloudDraft}
              onChange={(e) => setCloudDraft(e.target.value)}
            />
            <button type="button" className="btn primary" onClick={saveCloudUrl}>
              Save cloud URL
            </button>
          </div>
        )}

        <p className="driver-connect-status" role="status">
          {status}
        </p>

        {linked ? (
          <div className="driver-connect-section">
            <p>
              <strong>Bus:</strong> {session.plate ?? session.busId}
            </p>
            {session.lanIp && (
              <p>
                <strong>LAN:</strong> {session.lanIp}:{session.controlPort ?? 5174}
              </p>
            )}
            <div className="driver-connect-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!controlReady || busy}
                onClick={openControl}
              >
                Open control
              </button>
              <button type="button" className="btn secondary" disabled={busy} onClick={handleUnlink}>
                Unlink
              </button>
            </div>
            <p className="driver-connect-foot">Live GPS is sent to the fleet map while this app is open.</p>
          </div>
        ) : (
          <form className="driver-connect-section" onSubmit={handlePair}>
            <label htmlFor="plateOrCode">Number plate or 4-digit code</label>
            <input
              id="plateOrCode"
              type="text"
              autoComplete="off"
              inputMode="text"
              placeholder="KL07AB1234 or 7291"
              value={plateOrCode}
              onChange={(e) => setPlateOrCode(e.target.value)}
              disabled={busy || needsCloudUrl || !ready}
            />
            <button type="submit" className="btn primary" disabled={busy || needsCloudUrl || !ready}>
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
