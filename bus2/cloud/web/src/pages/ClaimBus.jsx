import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';

export default function ClaimBus() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [plate, setPlate] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);

  useEffect(() => {
    api('/api/fleet/pending')
      .then((json) => setPending(json.pending ?? []))
      .catch(() => {});
  }, []);

  async function handleClaim(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const json = await api('/api/fleet/claim', {
        method: 'POST',
        body: JSON.stringify({ fleetClaimCode: code, plate }),
      });
      if (!json.ok) {
        setMessage(json.error ?? 'Claim failed');
        return;
      }
      setMessage(`Linked bus ${json.busId}${json.profile?.plateDisplay ? ` (${json.profile.plateDisplay})` : ''}`);
      setCode('');
      setPlate('');
    } catch (err) {
      setMessage(err.message ?? 'Claim failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 480 }}>
      <h2>Claim bus</h2>
      <p className="hint">
        Enter the 6-digit fleet code shown on the bus PC display to add it to your fleet.
      </p>

      {pending.length > 0 && (
        <div className="hint" style={{ marginBottom: '1rem' }}>
          <strong>{pending.length}</strong> bus(es) waiting to be claimed.
        </div>
      )}

      <form onSubmit={handleClaim}>
        <div className="form-group">
          <label htmlFor="fleetCode">Fleet code</label>
          <input
            id="fleetCode"
            inputMode="numeric"
            autoComplete="off"
            placeholder="482913"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="plate">Number plate</label>
          <input
            id="plate"
            placeholder="KL 07 AB 1234"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
          {busy ? 'Claiming…' : 'Claim bus'}
        </button>
      </form>

      {message && <p className="hint">{message}</p>}
    </div>
  );
}
