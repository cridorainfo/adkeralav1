import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';
import { isBusOnline } from './FleetMap.jsx';

export default function LiveBusPanel() {
  const { selectedBusId } = useSelectedBus();
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
    setData(json);
  }, [selectedBusId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const telemetry = data?.telemetry ?? {};
  const snapshot = data?.displaySnapshot;
  const view = snapshot?.displayView ?? telemetry?.displayView ?? 'route';

  return (
    <div className="grid-2">
      <div className="card">
        <h2>Status — {selectedBusId}</h2>
        <p>
          <span className={`status-dot ${data?.online ? 'online' : 'offline'}`} />
          {data?.online ? 'Online' : 'Offline'}
          {data?.updatedAt ? ` · ${new Date(data.updatedAt).toLocaleString()}` : ''}
        </p>
        <pre style={{ background: '#f3f4f6', padding: '0.75rem', borderRadius: 8, overflow: 'auto', fontSize: '0.78rem' }}>
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
        </div>
      </div>
    </div>
  );
}
