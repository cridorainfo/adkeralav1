import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import FleetMap, { isBusOnline } from './FleetMap.jsx';
import { useSelectedBus } from './BusContext.jsx';

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
          <strong>Pair driver</strong> — driver opens <code>http://&lt;bus-ip&gt;:5174/control</code> on bus Wi‑Fi, or the native driver app at <code>/driver</code>.
        </li>
        <li>
          <strong>Push content</strong> — assign routes, ads, and voices from this dashboard; changes sync to the bus PC and driver phone automatically.
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
  const [newBusId, setNewBusId] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const json = await api('/api/buses');
    setBuses(json.buses ?? []);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selectedBusId) return;
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
    setProfile(json.profile);
    setPlate(json.profile?.plateDisplay || json.profile?.plate || '');
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

  async function savePlate() {
    setMessage('');
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/profile`, {
      method: 'PUT',
      body: JSON.stringify({ plate }),
    });
    setMessage('Plate saved');
    refreshSelected();
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

  async function unlinkDriver() {
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/unlink-driver`, { method: 'POST' });
    setMessage('Driver unlinked');
    refreshSelected();
  }

  async function revokeDevice() {
    if (!selectedBusId || !window.confirm(`Revoke device credentials for ${selectedBusId}?`)) return;
    await api(`/api/fleet/revoke/${encodeURIComponent(selectedBusId)}`, { method: 'POST' });
    setMessage('Device revoked — bus must be re-claimed');
    refreshSelected();
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
                {bus.busId}
              </span>
              <small>
                {bus.telemetry?.driverLocation?.lat != null
                  ? `${bus.telemetry.driverLocation.lat.toFixed(4)}, ${bus.telemetry.driverLocation.lng.toFixed(4)}`
                  : 'no GPS'}
              </small>
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

          <h3>Pairing setup</h3>
          <p className="hint">Drivers pair with plate or the 4-digit code shown on the bus display.</p>
          <div className="form-group">
            <label>Number plate</label>
            <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="KL 07 AB 1234" />
          </div>
          {profile && (
            <p className="hint">
              Pairing code: <strong>{profile.pairingCode || '—'}</strong>
              {profile.linkedDriverId ? ' · Driver linked' : ''}
            </p>
          )}
          <div className="editor-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={savePlate}>
              Save plate
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={unlinkDriver}>
              Unlink driver
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={revokeDevice}>
              Revoke device
            </button>
          </div>
          {message && <p className="hint">{message}</p>}
        </div>
        <div className="card">
          <h2>Live map</h2>
          <FleetMap buses={buses} selectedBusId={selectedBusId} onSelectBus={setSelectedBusId} />
        </div>
      </div>
    </>
  );
}
