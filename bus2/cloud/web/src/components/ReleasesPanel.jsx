import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { busDisplayLabel } from './BusContext.jsx';

export default function ReleasesPanel() {
  const [fleet, setFleet] = useState(null);
  const [minPc, setMinPc] = useState('');
  const [minDriver, setMinDriver] = useState('');
  const [pcRelease, setPcRelease] = useState({ version: '', downloadUrl: '', sha512: '', releaseNotes: '' });
  const [driverRelease, setDriverReleaseForm] = useState({ version: '', downloadUrl: '', releaseNotes: '' });
  const [message, setMessage] = useState('');
  const [pushing, setPushing] = useState(false);
  const [busQuery, setBusQuery] = useState('');
  const [removingDriverId, setRemovingDriverId] = useState(null);

  async function pushUpdateToFleet() {
    if (!window.confirm('Restart all buses to install the latest PC app? Buses restart in ~2 minutes.')) {
      return;
    }
    setPushing(true);
    setMessage('');
    try {
      const json = await api('/api/releases/push-update', {
        method: 'POST',
        body: JSON.stringify({ targetBusIds: 'all', delaySec: 120 }),
      });
      setMessage(`Update restart queued for ${json.queuedFor ?? 0} bus(es).`);
    } catch (err) {
      setMessage(err.message ?? 'Push failed');
    } finally {
      setPushing(false);
    }
  }

  async function load() {
    const json = await api('/api/releases/fleet');
    setFleet(json);
    setMinPc(json.minPcVersion ?? '');
    setMinDriver(json.minDriverVersion ?? '');
  }

  useEffect(() => {
    load();
  }, []);

  async function saveMinVersions() {
    await api('/api/releases/min-versions', {
      method: 'PUT',
      body: JSON.stringify({ minPcVersion: minPc, minDriverVersion: minDriver }),
    });
    setMessage('Minimum versions saved');
    load();
  }

  async function savePcRelease() {
    await api('/api/releases/pc', { method: 'PUT', body: JSON.stringify(pcRelease) });
    setMessage(`PC release v${pcRelease.version} registered`);
    load();
  }

  async function saveDriverRelease() {
    await api('/api/releases/driver', { method: 'PUT', body: JSON.stringify(driverRelease) });
    setMessage(`Driver release v${driverRelease.version} registered`);
    load();
  }

  const filteredBuses = useMemo(() => {
    const rows = fleet?.buses ?? [];
    const q = busQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.busId, row.displayName, row.plateDisplay].some((v) => v?.toLowerCase().includes(q))
    );
  }, [fleet, busQuery]);

  const orphanedDrivers = (fleet?.drivers ?? []).filter((d) => d.orphaned);

  async function removeDriver(driverId) {
    if (!window.confirm('Remove this driver app record? It can reconnect and re-register later.')) return;
    setRemovingDriverId(driverId);
    try {
      await api(`/api/drivers/${driverId}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setMessage(err.message ?? 'Failed to remove driver');
    } finally {
      setRemovingDriverId(null);
    }
  }

  async function removeAllOrphanedDrivers() {
    if (!orphanedDrivers.length) return;
    if (
      !window.confirm(
        `Remove ${orphanedDrivers.length} driver app record(s) not linked to any current bus?`
      )
    ) {
      return;
    }
    setMessage('');
    for (const driver of orphanedDrivers) {
      try {
        await api(`/api/drivers/${driver.driverId}`, { method: 'DELETE' });
      } catch (err) {
        setMessage(err.message ?? 'Failed to remove some driver records');
      }
    }
    load();
  }

  return (
    <>
      <div className="card">
        <h2>Ship updates to fleet</h2>
        <p className="hint">
          Buses check for updates every 15 minutes and download automatically. After you ship with{' '}
          <code>npm run ship</code>, use this to restart buses and install immediately.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={pushUpdateToFleet}
          disabled={pushing}
        >
          {pushing ? 'Queuing…' : 'Push update to all buses now'}
        </button>
      </div>

      <div className="card">
        <h2>Fleet versions</h2>
        {fleet && (
          <p className="hint">
            Cloud v{fleet.cloudVersion} · Latest PC v{fleet.latestPc ?? 'none'} · Latest driver v{fleet.latestDriver ?? 'none'}
          </p>
        )}
        <div className="toolbar">
          <input
            placeholder="Search by bus name, plate, or ID…"
            value={busQuery}
            onChange={(e) => setBusQuery(e.target.value)}
          />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Bus</th>
              <th>Plate</th>
              <th>Online</th>
              <th>App version</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredBuses.map((row) => (
              <tr key={row.busId}>
                <td>
                  {busDisplayLabel({ busId: row.busId, profile: { displayName: row.displayName, plateDisplay: row.plateDisplay } })}
                  <br />
                  <small className="hint">{row.busId}</small>
                </td>
                <td>{row.plateDisplay ?? '—'}</td>
                <td>{row.online ? 'Yes' : 'No'}</td>
                <td>{row.appVersion ?? '—'}</td>
                <td>
                  <span className={`version-pill version-${row.pcStatus === 'current' ? 'current' : row.pcStatus === 'outdated' ? 'outdated' : row.pcStatus === 'below-minimum' ? 'below' : 'unknown'}`}>
                    {row.pcStatus}
                  </span>
                </td>
              </tr>
            ))}
            {!filteredBuses.length && (
              <tr><td colSpan={5} className="hint">No buses match "{busQuery}"</td></tr>
            )}
          </tbody>
        </table>

        <h3>Driver apps</h3>
        {orphanedDrivers.length > 0 && (
          <p className="hint">
            {orphanedDrivers.length} driver app(s) not linked to any current bus.{' '}
            <button type="button" className="btn btn-outline btn-sm" onClick={removeAllOrphanedDrivers}>
              Remove all orphaned
            </button>
          </p>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Bus</th>
              <th>App version</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(fleet?.drivers ?? []).map((row) => (
              <tr key={row.driverId}>
                <td><code>{row.driverId.slice(0, 8)}…</code></td>
                <td>
                  {row.linkedBusId ?? '—'}
                  {row.orphaned && <span className="version-pill version-below"> orphaned</span>}
                </td>
                <td>{row.appVersion ?? '—'}</td>
                <td>
                  <span className={`version-pill version-${row.status === 'current' ? 'current' : row.status === 'outdated' ? 'outdated' : row.status === 'below-minimum' ? 'below' : 'unknown'}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={removingDriverId === row.driverId}
                    onClick={() => removeDriver(row.driverId)}
                  >
                    {removingDriverId === row.driverId ? 'Removing…' : 'Remove'}
                  </button>
                </td>
              </tr>
            ))}
            {!fleet?.drivers?.length && (
              <tr><td colSpan={5} className="hint">No driver version reports yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Minimum versions</h2>
          <div className="form-group">
            <label>Min PC version</label>
            <input value={minPc} onChange={(e) => setMinPc(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Min driver version</label>
            <input value={minDriver} onChange={(e) => setMinDriver(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveMinVersions}>
            Save
          </button>
        </div>
        <div className="card">
          <h2>Register PC release</h2>
          <div className="form-group">
            <label>Version</label>
            <input value={pcRelease.version} onChange={(e) => setPcRelease({ ...pcRelease, version: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Download URL</label>
            <input value={pcRelease.downloadUrl} onChange={(e) => setPcRelease({ ...pcRelease, downloadUrl: e.target.value })} />
          </div>
          <div className="form-group">
            <label>SHA512</label>
            <input value={pcRelease.sha512} onChange={(e) => setPcRelease({ ...pcRelease, sha512: e.target.value })} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={savePcRelease}>
            Register PC release
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Register driver APK release</h2>
        <div className="inline-form">
          <div className="form-group">
            <label>Version</label>
            <input value={driverRelease.version} onChange={(e) => setDriverReleaseForm({ ...driverRelease, version: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Download URL</label>
            <input value={driverRelease.downloadUrl} onChange={(e) => setDriverReleaseForm({ ...driverRelease, downloadUrl: e.target.value })} />
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={saveDriverRelease}>
            Register driver release
          </button>
        </div>
      </div>
      {message && <p className="hint">{message}</p>}
    </>
  );
}
