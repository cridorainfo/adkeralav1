import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import FleetMap, { isBusOnline } from './FleetMap.jsx';
import FleetBusDetail from './FleetBusDetail.jsx';
import { busDisplayLabel, useSelectedBus } from './BusContext.jsx';

function OnboardingWizard({ allowRegister, claimHref }) {
  const [pcDownload, setPcDownload] = useState(null);

  useEffect(() => {
    fetch('/api/releases/pc/latest')
      .then((r) => r.json())
      .then((json) => setPcDownload(json.release ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2>Add a new bus</h2>
      <ol className="onboarding-steps" style={{ lineHeight: 1.7, paddingLeft: '1.25rem' }}>
        <li>
          <strong>Download PC app</strong> — install the AdKerala Display app on the bus computer.
          {pcDownload?.downloadUrl ? (
            <>
              {' '}
              <a href={pcDownload.downloadUrl} target="_blank" rel="noopener noreferrer">
                Download v{pcDownload.version}
              </a>
            </>
          ) : (
            <span className="hint"> (register a release in Releases tab first)</span>
          )}
        </li>
        <li>
          <strong>Boot &amp; claim</strong> — on first launch the display shows a <strong>6-digit fleet code</strong>.
          {allowRegister ? (
            <>
              {' '}
              Register bus ID below
              {claimHref ? (
                <>
                  , or <Link to={claimHref}>claim with fleet code</Link>
                </>
              ) : (
                ', or have the owner claim in the Owner portal'
              )}
              .
            </>
          ) : claimHref ? (
            <>
              {' '}
              Use <Link to={claimHref}>Claim bus</Link> with the code and plate.
            </>
          ) : null}
        </li>
        <li>
          <strong>Verify online</strong> — bus polls cloud every ~5s; it appears in the fleet list with a green dot when online.
        </li>
        <li>
          <strong>Pair driver</strong> — driver scans QR on the bus display and enters the <strong>admin OTP</strong>.
          Linked drivers send live GPS to the fleet map automatically.
        </li>
        <li>
          <strong>Push content</strong> — use <strong>Ads</strong> tab with a bus selected to push ads to that bus only.
        </li>
      </ol>
    </div>
  );
}

export default function FleetPanel({ allowRegister = false, claimHref = null }) {
  const { selectedBusId, setSelectedBusId, refreshBuses } = useSelectedBus();
  const [buses, setBuses] = useState([]);
  const [profile, setProfile] = useState(null);
  const [plate, setPlate] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newBusId, setNewBusId] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [message, setMessage] = useState('');
  const [driverOtp, setDriverOtp] = useState(null);

  const refresh = useCallback(async () => {
    const json = await api('/api/buses');
    setBuses(json.buses ?? []);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selectedBusId) return;
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
    setProfile(json.profile);
  }, [selectedBusId]);

  /** Load editable fields only when switching buses — not on every poll. */
  useEffect(() => {
    if (!selectedBusId) {
      setProfile(null);
      setPlate('');
      setDisplayName('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
      if (cancelled) return;
      setProfile(json.profile);
      setPlate(json.profile?.plateDisplay || json.profile?.plate || '');
      setDisplayName(json.profile?.displayName ?? '');
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBusId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    refreshSelected();
    const t = setInterval(refreshSelected, 4000);
    return () => clearInterval(t);
  }, [refreshSelected]);

  const refreshDriverOtp = useCallback(async () => {
    if (!selectedBusId) return;
    const ownerId = profile?.ownerId;
    const q = ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : '';
    try {
      const json = await api(`/api/fleet/driver-otp${q}`);
      setDriverOtp(json);
    } catch {
      setDriverOtp(null);
    }
  }, [selectedBusId, profile?.ownerId]);

  useEffect(() => {
    refreshDriverOtp();
  }, [refreshDriverOtp]);

  async function saveProfile() {
    if (!selectedBusId) return;
    setMessage('');
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/profile`, {
      method: 'PUT',
      body: JSON.stringify({ plate, displayName }),
    });
    setProfile(json.profile);
    setPlate(json.profile?.plateDisplay || json.profile?.plate || plate);
    setDisplayName(json.profile?.displayName ?? displayName);
    setMessage('Bus profile saved');
    refreshBuses();
  }

  async function registerBus() {
    if (!newBusId.trim()) {
      setMessage('Enter a bus ID');
      return;
    }
    setMessage('');
    try {
      const json = await api('/api/buses/register', {
        method: 'POST',
        body: JSON.stringify({ busId: newBusId.trim(), plate: newPlate }),
      });
      setMessage(`Registered ${json.busId ?? newBusId}`);
      setNewBusId('');
      setNewPlate('');
      setSelectedBusId(json.busId ?? newBusId.trim());
      await refresh();
      refreshBuses();
    } catch (err) {
      setMessage(err.message ?? 'Register failed');
    }
  }

  async function rotateDriverOtp() {
    setMessage('');
    try {
      const ownerId = profile?.ownerId;
      const json = await api('/api/fleet/driver-otp/refresh', {
        method: 'POST',
        body: JSON.stringify(ownerId ? { ownerId } : {}),
      });
      setDriverOtp(json);
      setMessage('New driver OTP — share with drivers (old OTP no longer works)');
    } catch (err) {
      setMessage(err.message ?? 'Could not refresh OTP');
    }
  }

  async function disconnectDriver() {
    if (!selectedBusId) return;
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/unlink-driver`, { method: 'POST' });
    setMessage('Driver disconnected — pairing QR will show on the bus display');
    refreshSelected();
  }

  async function revokeDevice() {
    if (!selectedBusId || !window.confirm(`Revoke device credentials for ${selectedBusId}?`)) return;
    await api(`/api/fleet/revoke/${encodeURIComponent(selectedBusId)}`, { method: 'POST' });
    setMessage('Device revoked — bus must be re-claimed');
    refreshSelected();
  }

  async function deleteBus() {
    if (!selectedBusId) return;
    const label = displayName || plate || selectedBusId;
    if (
      !window.confirm(
        `Delete bus "${label}" (${selectedBusId})?\n\nThis removes the bus from the fleet. The PC must be re-claimed.`
      )
    ) {
      return;
    }
    setMessage('');
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}`, { method: 'DELETE' });
      setMessage(`Deleted ${selectedBusId}`);
      setSelectedBusId('');
      await refresh();
      refreshBuses();
    } catch (err) {
      setMessage(err.message ?? 'Delete failed');
    }
  }

  return (
    <>
      <OnboardingWizard allowRegister={allowRegister} claimHref={claimHref} />
      <div className="grid-2">
        <div className="card">
          <h2>Fleet</h2>
          {(buses ?? []).map((bus) => (
            <div
              key={bus.busId}
              className={`bus-list-item ${bus.busId === selectedBusId ? 'selected' : ''}`}
              onClick={() => setSelectedBusId(bus.busId)}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedBusId(bus.busId)}
              role="button"
              tabIndex={0}
            >
              <span>
                <span className={`status-dot ${isBusOnline(bus.updatedAt) ? 'online' : 'offline'}`} />
                {busDisplayLabel(bus)}
              </span>
              <small>{bus.busId}</small>
            </div>
          ))}
          {!buses.length && <p className="hint">No buses yet. Register one below.</p>}

          {allowRegister && (
            <>
              <h3>Register bus (optional)</h3>
              <p className="hint">
                Pre-create a bus profile by ID. To link a real bus PC, use <strong>Claim bus</strong> with the 6-digit code from the display.
              </p>
              <div className="inline-form">
                <div className="form-group">
                  <label>Bus ID</label>
                  <input value={newBusId} onChange={(e) => setNewBusId(e.target.value)} placeholder="bus-1" />
                </div>
                <div className="form-group">
                  <label>Plate</label>
                  <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} placeholder="KL 07 AB 1234" />
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={registerBus}>
                  Add bus
                </button>
              </div>
            </>
          )}

          {selectedBusId && (
            <>
              <h3>Bus profile</h3>
              <p className="hint">Bus ID: <strong>{selectedBusId}</strong></p>
              <div className="form-group">
                <label>Friendly name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Route 42 — Trivandrum"
                />
              </div>
              <div className="form-group">
                <label>Number plate</label>
                <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="KL 07 AB 1234" />
              </div>

              <h3>Driver access</h3>
              <p className="hint">Drivers scan the bus QR and enter this fleet OTP.</p>
              {driverOtp?.otp && (
                <div className="driver-otp-panel">
                  <p className="hint" style={{ marginBottom: '0.35rem' }}>
                    Driver OTP <span className="hint">(same for all buses until refreshed)</span>
                  </p>
                  <p className="driver-otp-value">{driverOtp.otp}</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={rotateDriverOtp}>
                    New OTP
                  </button>
                </div>
              )}
              {profile && (
                <p className="hint">
                  Pairing code: <strong>{profile.pairingCode || '—'}</strong>
                  {profile.linkedDriverId ? ' · Driver connected' : ''}
                </p>
              )}
              <div className="editor-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={saveProfile}>
                  Save profile
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={disconnectDriver}>
                  Disconnect driver
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={revokeDevice}>
                  Revoke device
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={deleteBus}>
                  Delete bus
                </button>
              </div>
            </>
          )}
          {message && <p className="hint">{message}</p>}

          {selectedBusId && <FleetBusDetail busId={selectedBusId} buses={buses} />}
        </div>
        <div className="card">
          <h2>Live map</h2>
          <FleetMap buses={buses} selectedBusId={selectedBusId} onSelectBus={setSelectedBusId} />
        </div>
      </div>
    </>
  );
}
