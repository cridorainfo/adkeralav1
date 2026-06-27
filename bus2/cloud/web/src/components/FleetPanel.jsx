import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import FleetMap, { isBusOnline } from './FleetMap.jsx';
import { useSelectedBus } from './BusContext.jsx';

export default function FleetPanel({ allowRegister = false }) {
  const { selectedBusId, setSelectedBusId } = useSelectedBus();
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
    setMessage('');
    await api('/api/buses/register', {
      method: 'POST',
      body: JSON.stringify({ busId: newBusId, plate: newPlate }),
    });
    setMessage(`Registered ${newBusId}`);
    setNewBusId('');
    setNewPlate('');
    refresh();
  }

  async function unlinkDriver() {
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/unlink-driver`, { method: 'POST' });
    setMessage('Driver unlinked');
    refreshSelected();
  }

  return (
    <>
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
              <h3>Register bus</h3>
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
