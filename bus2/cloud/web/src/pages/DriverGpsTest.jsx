import { useEffect, useState } from 'react';
import AdKeralaLogo from '../components/AdKeralaLogo.jsx';
import { APP_NAME } from '../lib/brand.js';
import GpsSyncStatus from '../components/GpsSyncStatus.jsx';
import { useDriverGps } from '../hooks/useDriverGps.js';
import { useDriverCloudLocation } from '../hooks/useDriverCloudLocation.js';
import { useGpsReliabilityStats } from '../hooks/useGpsReliabilityStats.js';
import {
  ensureDriverId,
  fetchDriverSession,
  loadCloudUrl,
  pairDriver,
  unlinkDriver,
} from '../lib/driverPhone.js';

/**
 * Standalone GPS test harness — links this phone to a bus purely over the internet
 * (cloud pairDriver/api, no LAN hub, no bus-PC dependency beyond it being online once
 * to link). Lets you test GPS streaming with the phone anywhere, bus PC left in one room.
 */
export default function DriverGpsTest() {
  const [code, setCode] = useState('');
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');

  const linked = Boolean(session?.linked);

  const refreshSession = async () => {
    const driverId = ensureDriverId();
    const cloudUrl = loadCloudUrl();
    const result = await fetchDriverSession(driverId, cloudUrl);
    setSession(result);
    return result;
  };

  useEffect(() => {
    (async () => {
      try {
        await refreshSession();
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const handleLink = async (e) => {
    e.preventDefault();
    setError('');
    setLinking(true);
    try {
      const driverId = ensureDriverId();
      const cloudUrl = loadCloudUrl();
      const result = await pairDriver(driverId, code, cloudUrl);
      if (!result.ok) {
        setError(result.error ?? 'Could not link');
        return;
      }
      await refreshSession();
      setCode('');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlink = async () => {
    const driverId = ensureDriverId();
    const cloudUrl = loadCloudUrl();
    await unlinkDriver(driverId, cloudUrl);
    await refreshSession();
  };

  const { location, permission, requestGps, trackingMode } = useDriverGps(linked);
  const { lastSyncedAt, lastError: syncError, pushCount } = useDriverCloudLocation({
    enabled: linked,
    location,
    linked,
  });
  const reliability = useGpsReliabilityStats(location);

  return (
    <div className="driver-connect-page">
      <div className="driver-connect-card">
        <div className="driver-connect-header">
          <AdKeralaLogo className="driver-connect-logo" size="lg" />
          <h1>{APP_NAME} GPS test</h1>
          <p className="driver-connect-status" role="status">
            Links over the internet — no bus Wi‑Fi needed. Bus PC just needs to be online once to link.
          </p>
        </div>

        {checking ? (
          <p className="driver-connect-status">Checking link status…</p>
        ) : !linked ? (
          <div className="driver-connect-section">
            <p className="hint">Enter the bus plate or 4‑digit pairing code from admin.</p>
            <form onSubmit={handleLink}>
              <label htmlFor="busCode">Bus plate or pairing code</label>
              <input
                id="busCode"
                type="text"
                autoComplete="off"
                placeholder="e.g. KL07AB1234 or 4821"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={linking || !code.trim()}>
                {linking ? 'Linking…' : 'Link this phone'}
              </button>
              {error && <p className="driver-connect-error">{error}</p>}
            </form>
          </div>
        ) : (
          <div className="driver-connect-section">
            <p className="hint">
              Linked to <strong>{session.plate || session.busId}</strong>.
            </p>
            <GpsSyncStatus
              location={location}
              permission={permission}
              onEnableGps={requestGps}
              linked={linked}
              syncError={syncError}
              lastSyncedAt={lastSyncedAt}
              pushCount={pushCount}
              trackingMode={trackingMode}
              reliability={reliability}
            />
            <button type="button" className="btn btn-ghost" onClick={handleUnlink}>
              Unlink this phone
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
