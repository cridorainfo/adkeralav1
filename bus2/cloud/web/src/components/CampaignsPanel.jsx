import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { uploadMedia } from '../lib/api.js';

export default function CampaignsPanel({ adminMode = false }) {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [buses, setBuses] = useState([]);
  const [form, setForm] = useState({ name: '', targetBusIds: [] });
  const [message, setMessage] = useState('');

  async function load() {
    const [cJson, bJson] = await Promise.all([api('/api/campaigns'), api('/api/buses')]);
    setCampaigns(cJson.campaigns ?? []);
    setBuses(bJson.buses ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function createCampaign(e) {
    e.preventDefault();
    setMessage('');
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        targetBusIds: form.targetBusIds,
        ads: form.ads ?? [],
        bannerAds: form.bannerAds ?? [],
      }),
    });
    setForm({ name: '', targetBusIds: [] });
    setMessage('Campaign created');
    load();
  }

  async function approve(id) {
    await api(`/api/campaigns/${encodeURIComponent(id)}/approve`, { method: 'POST' });
    load();
  }

  async function push(id) {
    await api(`/api/campaigns/${encodeURIComponent(id)}/push`, { method: 'POST' });
    setMessage('Campaign pushed to buses');
  }

  async function uploadAd(file, isBanner) {
    const category = isBanner ? 'banners' : 'ads';
    const up = await uploadMedia(file, category);
    const key = isBanner ? 'bannerAds' : 'ads';
    const item = {
      id: `${isBanner ? 'banner' : 'ad'}-${Date.now()}`,
      name: file.name,
      type: file.type.startsWith('video') ? 'video' : 'image',
      mediaFile: up.path,
      durationSec: isBanner ? 8 : 12,
    };
    setForm({ ...form, [key]: [...(form[key] ?? []), item] });
  }

  function toggleBus(busId) {
    const ids = form.targetBusIds.includes(busId)
      ? form.targetBusIds.filter((id) => id !== busId)
      : [...form.targetBusIds, busId];
    setForm({ ...form, targetBusIds: ids });
  }

  return (
    <>
      {(user?.role === 'advertiser' || adminMode) && (
        <div className="card">
          <h2>{adminMode ? 'All campaigns' : 'My campaigns'}</h2>
          {user?.role === 'advertiser' && (
            <>
              <form onSubmit={createCampaign}>
                <div className="form-group">
                  <label>Campaign name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Target buses</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {buses.map((b) => (
                      <label key={b.busId} style={{ fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={form.targetBusIds.includes(b.busId)}
                          onChange={() => toggleBus(b.busId)}
                        />{' '}
                        {b.busId}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label>Fullscreen ad media</label>
                  <input type="file" accept="image/*,video/*" onChange={(e) => uploadAd(e.target.files?.[0], false)} />
                </div>
                <div className="form-group">
                  <label>Banner ad media</label>
                  <input type="file" accept="image/*" onChange={(e) => uploadAd(e.target.files?.[0], true)} />
                </div>
                <button type="submit" className="btn btn-primary btn-sm">
                  Create campaign
                </button>
              </form>
              {message && <p className="hint">{message}</p>}
            </>
          )}
          {campaigns.map((c) => (
            <div key={c.id} className="campaign-card">
              <strong>{c.name}</strong>{' '}
              <span className={`campaign-status ${c.status}`}>{c.status}</span>
              <p className="hint">
                {c.ads?.length ?? 0} fullscreen · {c.bannerAds?.length ?? 0} banner · targets:{' '}
                {(c.targetBusIds ?? []).join(', ') || 'none'}
              </p>
              <div className="editor-actions">
                {adminMode && c.status === 'pending' && (
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(c.id)}>
                    Approve
                  </button>
                )}
                {(adminMode || user?.role === 'bus_owner') && c.status === 'active' && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => push(c.id)}>
                    Push to buses
                  </button>
                )}
              </div>
            </div>
          ))}
          {!campaigns.length && <p className="empty-state">No campaigns yet.</p>}
        </div>
      )}
    </>
  );
}
