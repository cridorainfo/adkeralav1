import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** Read-only view of the platform's audit trail — pricing changes, user role/status changes,
 * campaign/schedule create/update/delete, house-ads edits, and release pushes. The write side
 * (cloud/logger.js writeAudit) already existed; this panel and its GET /api/audit-log endpoint
 * are new — previously there was no way for an admin to actually see who changed what. See the
 * feature-gap audit's finding on this. Coverage isn't every mutating endpoint in the app yet,
 * just the highest-value ones for "who changed this, and when" disputes. */
export default function AuditLogPanel() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');

  async function load() {
    setError('');
    try {
      const [auditJson, usersJson] = await Promise.all([
        api('/api/audit-log?limit=500'),
        api('/api/users').catch(() => ({ users: [] })),
      ]);
      setEntries(auditJson.entries ?? []);
      setUsers(usersJson.users ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load audit log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const actorLabel = (actorId) => {
    if (!actorId) return 'System';
    const u = usersById.get(actorId);
    return u ? u.name || u.email : actorId;
  };

  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const visible = actionFilter ? entries.filter((e) => e.action === actionFilter) : entries;

  return (
    <div className="card">
      <h2>Audit log</h2>
      <p className="hint">
        Who changed pricing, campaigns, schedules, house ads, user roles, and release pushes, and
        when. Most recent first.
      </p>
      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {loading && <p className="hint">Loading…</p>}

      {!loading && (
        <>
          <div className="form-group">
            <label>Filter by action</label>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          {!visible.length && <p className="empty-state">No audit entries yet.</p>}

          <table className="data-table responsive-desktop">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{actorLabel(e.actorId)}</td>
                  <td>
                    <code>{e.action}</code>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--kerala-muted)' }}>
                    {Object.entries(e.details ?? {})
                      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="table-card-list">
            {visible.map((e) => (
              <div className="table-card" key={e.id}>
                <div className="table-card-title">{e.action}</div>
                <div className="table-card-row">
                  <span className="table-card-row-label">When</span>
                  <span>{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-row-label">Who</span>
                  <span>{actorLabel(e.actorId)}</span>
                </div>
                <div className="table-card-row">
                  <span className="table-card-row-label">Details</span>
                  <span style={{ fontSize: '0.8rem' }}>
                    {Object.entries(e.details ?? {})
                      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                      .join(', ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
