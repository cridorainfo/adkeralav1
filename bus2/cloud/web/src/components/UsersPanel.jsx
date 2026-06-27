import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { ROLE_LABELS } from '../lib/brand.js';

export default function UsersPanel() {
  const [users, setUsers] = useState([]);

  async function load() {
    const json = await api('/api/users');
    setUsers(json.users ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateUser(userId, patch) {
    await api(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    load();
  }

  return (
    <div className="card">
      <h2>Users</h2>
      <p className="hint">Manage platform accounts and roles.</p>
      <table className="data-table">
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
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} onChange={(e) => updateUser(u.id, { role: e.target.value })}>
                  {Object.keys(ROLE_LABELS).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td>{u.status}</td>
              <td>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => updateUser(u.id, { status: u.status === 'active' ? 'suspended' : 'active' })}
                >
                  {u.status === 'active' ? 'Suspend' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
