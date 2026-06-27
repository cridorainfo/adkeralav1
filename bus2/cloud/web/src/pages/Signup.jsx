import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { dashboardPathForRole } from '../lib/brand.js';
import AuthLayout from '../layouts/AuthLayout.jsx';

const ROLES = [
  { id: 'bus_owner', label: 'Bus owner', desc: 'Manage fleet & routes', icon: '🚌' },
  { id: 'driver', label: 'Driver', desc: 'Pair & control buses', icon: '📱' },
  { id: 'advertiser', label: 'Advertiser', desc: 'Run ad campaigns', icon: '📣' },
];

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('role') || 'bus_owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setBusy(true);
    try {
      const user = await signup({ email, password, name, role });
      navigate(dashboardPathForRole(user.role), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Join AdKerala — pick the role that fits you"
      footer={
        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
          {' · '}
          Platform admin? <Link to="/login">Admin login</Link>
        </p>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit} className="auth-form">
        <fieldset className="role-picker">
          <legend>I am a…</legend>
          <div className="role-grid role-grid-3">
            {ROLES.map((r) => (
              <label key={r.id} className={`role-option ${role === r.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="role"
                  value={r.id}
                  checked={role === r.id}
                  onChange={() => setRole(r.id)}
                />
                <span className="role-option-icon">{r.icon}</span>
                <strong>{r.label}</strong>
                <span className="role-option-desc">{r.desc}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="form-group">
          <label htmlFor="name">Full name</label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required />
        </div>
        <div className="form-group">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoComplete="email"
          />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={6}
            />
          </div>
          <div className="form-group">
            <label htmlFor="confirm">Confirm</label>
            <input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
