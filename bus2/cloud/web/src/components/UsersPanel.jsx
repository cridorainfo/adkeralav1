import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ROLE_LABELS } from '../lib/brand.js';
import { downloadCsv } from '../lib/csvExport.js';

export default function UsersPanel() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busyUserId, setBusyUserId] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    setError('');
    try {
      const json = await api('/api/users');
      setUsers(json.users ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load users');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function updateUser(userId, patch) {
    setMessage('');
    setError('');
    setBusyUserId(userId);
    try {
      await api(`/api/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setMessage('Updated');
      load();
    } catch (err) {
      setError(err.message ?? 'Could not update user');
    } finally {
      setBusyUserId(null);
    }
  }

  // Elevating someone to admin, or suspending an account, both take effect immediately and are
  // easy to trigger by mistake (a stray click/arrow-key on the role dropdown) — confirm first,
  // same as every other hard-to-reverse action elsewhere in this dashboard.
  function changeRole(u, role) {
    if (role === u.role) return;
    if (
      role === 'admin' &&
      !window.confirm(`Give "${u.name || u.email}" full Platform Admin access? This can't be undone from here.`)
    ) {
      return;
    }
    updateUser(u.id, { role });
  }

  function toggleStatus(u) {
    const isSelf = currentUser?.id === u.id;
    if (isSelf && u.status === 'active') {
      window.alert("You can't suspend your own account from here — ask another admin to do it.");
      return;
    }
    const next = u.status === 'active' ? 'suspended' : 'active';
    if (next === 'suspended' && !window.confirm(`Suspend "${u.name || u.email}"? They'll be signed out and unable to log back in.`)) {
      return;
    }
    updateUser(u.id, { status: next });
  }

  function RoleSelect({ u }) {
    return (
      <select value={u.role} disabled={busyUserId === u.id} onChange={(e) => changeRole(u, e.target.value)}>
        {Object.keys(ROLE_LABELS).map((r) => (
          <option key={r} value={r}>
            {ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    );
  }

  function StatusButton({ u }) {
    const isSelf = currentUser?.id === u.id;
    return (
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busyUserId === u.id || (isSelf && u.status === 'active')}
        title={isSelf && u.status === 'active' ? "Can't suspend your own account" : undefined}
        onClick={() => toggleStatus(u)}
      >
        {u.status === 'active' ? 'Suspend' : 'Activate'}
      </button>
    );
  }

  const q = search.trim().toLowerCase();
  const visibleUsers = !q
    ? users
    : users.filter(
        (u) => (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)
      );

  return (
    <div className="card">
      <h2>Users</h2>
      <p className="hint">Manage platform accounts and roles.</p>
      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p className="hint">{message}</p>}
      <div className="form-group">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email"
        />
      </div>
      <div className="campaigns-header">
        <p className="hint" style={{ marginBottom: 0 }}>
          {visibleUsers.length} user{visibleUsers.length === 1 ? '' : 's'}
          {q ? ' matching' : ''}
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() =>
            downloadCsv(`adkerala-users-${new Date().toISOString().slice(0, 10)}.csv`, visibleUsers, [
              { key: 'name', label: 'Name' },
              { key: 'email', label: 'Email' },
              { key: 'role', label: 'Role' },
              { key: 'status', label: 'Status' },
            ])
          }
        >
          Export CSV
        </button>
      </div>
      <table className="data-table responsive-desktop">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleUsers.map((u) => (
            <tr key={u.id}>
              <td>
                {u.name}
                {currentUser?.id === u.id && <span className="hint"> (you)</span>}
              </td>
              <td>{u.email}</td>
              <td>
                <RoleSelect u={u} />
              </td>
              <td>{u.status}</td>
              <td>
                <StatusButton u={u} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="table-card-list">
        {visibleUsers.map((u) => (
          <div className="table-card" key={u.id}>
            <div className="table-card-title">
              {u.name}
              {currentUser?.id === u.id && <span className="hint"> (you)</span>}
            </div>
            <div className="table-card-row">
              <span className="table-card-row-label">Email</span>
              <span>{u.email}</span>
            </div>
            <div className="table-card-row">
              <span className="table-card-row-label">Role</span>
              <RoleSelect u={u} />
            </div>
            <div className="table-card-row">
              <span className="table-card-row-label">Status</span>
              <span>{u.status}</span>
            </div>
            <div className="table-card-actions">
              <StatusButton u={u} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
