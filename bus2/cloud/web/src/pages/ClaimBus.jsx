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
    let cancelled = false;
    const load = () => {
      api('/api/fleet/pending')
        .then((json) => {
          if (!cancelled) setPending(json.pending ?? []);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
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
      setMessage(
        json.reconnected
          ? `Re-linked bus ${json.busId}${json.profile?.plateDisplay ? ` (${json.profile.plateDisplay})` : ''}` +
              (json.restored ? ' — routes & settings queued for sync.' : ' — claim with same plate as before.')
          : `Linked bus ${json.busId}${json.profile?.plateDisplay ? ` (${json.profile.plateDisplay})` : ''}`
      );
      setCode('');
      setPlate('');
      if (json.busId) {
        window.dispatchEvent(new CustomEvent('adkerala-fleet-refresh'));
      }
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
        Use the <strong>same plate number</strong> as before to restore routes and settings after a reinstall.
      </p>

      {pending.length > 0 && (
        <div className="hint" style={{ marginBottom: '1rem' }}>
          <strong>{pending.length}</strong> unclaimed bus PC{pending.length === 1 ? '' : 's'} online
          now (showing fleet code on display):
          <ul className="fleet-pending-codes">
            {pending.slice(0, 8).map((row) => (
              <li key={row.installId}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setCode(row.fleetClaimCode ?? '')}
                >
                  {row.fleetClaimCode}
                </button>
                {row.appVersion ? ` · v${row.appVersion}` : ''}
              </li>
            ))}
          </ul>
          {pending.length > 8 && (
            <span>…and {pending.length - 8} more — enter the code from the bus screen.</span>
          )}
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
