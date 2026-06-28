import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

export default function LiveBusPanel() {
  const { selectedBusId } = useSelectedBus();
  const [data, setData] = useState(null);
  const [driveMessage, setDriveMessage] = useState('');
  const [lastQueuedAt, setLastQueuedAt] = useState(null);

  const refresh = useCallback(async () => {
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
    setData(json);
  }, [selectedBusId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  async function sendDrive(action, extra = {}) {
    if (!data?.online) {
      setDriveMessage('Bus is offline');
      return;
    }
    if (action === 'endTrip' && !window.confirm('End trip on this bus?')) return;
    setDriveMessage('Queuing…');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/drive`, {
        method: 'POST',
        body: JSON.stringify({ action, ...extra }),
      });
      setLastQueuedAt(Date.now());
      setDriveMessage(`Queued ${action} (cmd ${json.commandId?.slice(0, 8) ?? 'ok'})`);
    } catch (err) {
      setDriveMessage(err.message ?? 'Failed');
    }
  }

  const telemetry = data?.telemetry ?? {};
  const snapshot = data?.displaySnapshot;
  const view = snapshot?.displayView ?? telemetry?.displayView ?? 'route';
  const online = Boolean(data?.online);

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Status — {selectedBusId}</h2>
        <p>
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          {online ? 'Online' : 'Offline'}
          {data?.updatedAt ? ` · ${new Date(data.updatedAt).toLocaleString()}` : ''}
        </p>

        <h3>Remote control</h3>
        <p className="hint">Commands queue to the bus (~5s when online). Driver phone syncs from bus LAN automatically.</p>
        <div className="editor-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={!online} onClick={() => sendDrive('startTrip')}>
            Start trip
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={!online} onClick={() => sendDrive('forward')}>
            Forward
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!online} onClick={() => sendDrive('announce')}>
            Announce
          </button>
          <button type="button" className="btn btn-danger btn-sm" disabled={!online} onClick={() => sendDrive('endTrip')}>
            End trip
          </button>
        </div>
        {lastQueuedAt && (
          <p className="hint">Last command queued {new Date(lastQueuedAt).toLocaleTimeString()}</p>
        )}
        {driveMessage && <p className="hint">{driveMessage}</p>}

        <pre style={{ background: '#f3f4f6', padding: '0.75rem', borderRadius: 8, overflow: 'auto', fontSize: '0.78rem', marginTop: '1rem' }}>
          {JSON.stringify(telemetry, null, 2)}
        </pre>
      </div>
      <div className="card">
        <h2>Passenger screen mirror</h2>
        <div className="display-mirror">
          <div style={{ opacity: 0.8, fontSize: '0.85rem' }}>
            {view === 'ad' ? '📢 Advertisement' : '🚌 Route view'}
          </div>
          <h3>{snapshot?.routeName ?? telemetry?.routeName ?? '—'}</h3>
          <div>
            Current: <strong>{telemetry?.currentStopEn ?? '—'}</strong>
          </div>
          <div className="next">
            Next stop: <strong>{telemetry?.nextStopEn ?? '—'}</strong>
          </div>
          <div className="hint" style={{ marginTop: '0.75rem' }}>
            Trip: {telemetry?.tripStarted ? (telemetry?.tripEnded ? 'ended' : 'in progress') : 'not started'}
          </div>
        </div>
      </div>
    </div>
  );
}
