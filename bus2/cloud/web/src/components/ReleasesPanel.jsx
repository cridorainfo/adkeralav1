import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function ReleasesPanel() {
  const [fleet, setFleet] = useState(null);
  const [minPc, setMinPc] = useState('');
  const [minDriver, setMinDriver] = useState('');
  const [pcRelease, setPcRelease] = useState({ version: '', downloadUrl: '', sha512: '', releaseNotes: '' });
  const [driverRelease, setDriverReleaseForm] = useState({ version: '', downloadUrl: '', releaseNotes: '' });
  const [message, setMessage] = useState('');

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

  return (
    <>
      <div className="card">
        <h2>Fleet versions</h2>
        {fleet && (
          <p className="hint">
            Cloud v{fleet.cloudVersion} · Latest PC v{fleet.latestPc ?? 'none'} · Latest driver v{fleet.latestDriver ?? 'none'}
          </p>
        )}
        <table className="data-table">
          <thead>
            <tr>
              <th>Bus</th>
              <th>Online</th>
              <th>App version</th>
              <th>Status</th>
              <th>Plate</th>
            </tr>
          </thead>
          <tbody>
            {(fleet?.buses ?? []).map((row) => (
              <tr key={row.busId}>
                <td>{row.busId}</td>
                <td>{row.online ? 'Yes' : 'No'}</td>
                <td>{row.appVersion ?? '—'}</td>
                <td>
                  <span className={`version-pill version-${row.pcStatus === 'current' ? 'current' : row.pcStatus === 'outdated' ? 'outdated' : row.pcStatus === 'below-minimum' ? 'below' : 'unknown'}`}>
                    {row.pcStatus}
                  </span>
                </td>
                <td>{row.plateDisplay ?? '—'}</td>
              </tr>
            ))}
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
