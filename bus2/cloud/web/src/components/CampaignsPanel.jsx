import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { uploadMedia } from '../lib/api.js';
import { AD_MEDIA_ACCEPT, validateAdMediaFile, adMediaTypeFromFile } from '../lib/adMedia.js';

export default function CampaignsPanel({ adminMode = false }) {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [buses, setBuses] = useState([]);
  const [form, setForm] = useState({ name: '', targetBusIds: [], pendingAmount: '', pendingTriggerStopEn: '' });
  const [message, setMessage] = useState('');
  const [plays, setPlays] = useState({});
  const [adSpend, setAdSpend] = useState({});

  async function load() {
    const [cJson, bJson] = await Promise.all([api('/api/campaigns'), api('/api/buses')]);
    const loadedCampaigns = cJson.campaigns ?? [];
    setCampaigns(loadedCampaigns);
    setBuses(bJson.buses ?? []);

    // Proof-of-play summary per campaign — best-effort, one card's fetch failing (e.g. a
    // campaign with no plays yet) shouldn't block the others from showing.
    const summaries = await Promise.all(
      loadedCampaigns.map((c) =>
        api(`/api/campaigns/${encodeURIComponent(c.id)}/plays`).catch(() => null)
      )
    );
    const nextPlays = {};
    loadedCampaigns.forEach((c, i) => {
      if (summaries[i]) nextPlays[c.id] = summaries[i];
    });
    setPlays(nextPlays);

    // Per-ad spend vs budget — only fullscreen ads carry a budget/exhaustion concept today
    // (banner ads aren't instrumented by endAd()'s play tracking), so only fetch for those.
    const budgetedAds = loadedCampaigns.flatMap((c) => (c.ads ?? []).filter((ad) => ad.amount));
    const spendResults = await Promise.all(
      budgetedAds.map((ad) => api(`/api/ads/${encodeURIComponent(ad.id)}/spend`).catch(() => null))
    );
    const nextSpend = {};
    budgetedAds.forEach((ad, i) => {
      if (spendResults[i]) nextSpend[ad.id] = spendResults[i];
    });
    setAdSpend(nextSpend);
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
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const category = isBanner ? 'banners' : 'ads';
    const up = await uploadMedia(file, category);
    const key = isBanner ? 'bannerAds' : 'ads';
    const item = {
      id: `${isBanner ? 'banner' : 'ad'}-${Date.now()}`,
      name: file.name,
      type: adMediaTypeFromFile(file),
      mediaFile: up.path,
      durationSec: isBanner ? 8 : 12,
      // Budget/stop-trigger only apply to the fullscreen rotation — banner ads aren't tracked
      // by endAd()'s play instrumentation, so there's nothing to exhaust against yet.
      ...(!isBanner && form.pendingAmount ? { amount: Number(form.pendingAmount) } : {}),
      ...(!isBanner && form.pendingTriggerStopEn ? { triggerStopEn: form.pendingTriggerStopEn } : {}),
    };
    setForm({
      ...form,
      [key]: [...(form[key] ?? []), item],
      ...(!isBanner ? { pendingAmount: '', pendingTriggerStopEn: '' } : {}),
    });
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
                <p className="hint">
                  Set a budget and/or stop-trigger below first, then choose the fullscreen ad
                  file — selecting the file creates the ad using whatever's filled in here.
                </p>
                <div className="inline-form">
                  <div className="form-group">
                    <label>Budget for this ad (₹, optional)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Leave blank for unlimited"
                      value={form.pendingAmount}
                      onChange={(e) => setForm({ ...form, pendingAmount: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Show approaching stop (optional)</label>
                    <input
                      type="text"
                      placeholder="Exact stop name, e.g. Main Street"
                      value={form.pendingTriggerStopEn}
                      onChange={(e) => setForm({ ...form, pendingTriggerStopEn: e.target.value })}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Fullscreen ad media</label>
                  <input type="file" accept={AD_MEDIA_ACCEPT} onChange={(e) => uploadAd(e.target.files?.[0], false)} />
                </div>
                <div className="form-group">
                  <label>Banner ad media (image or video)</label>
                  <input type="file" accept={AD_MEDIA_ACCEPT} onChange={(e) => uploadAd(e.target.files?.[0], true)} />
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
              <p className="hint">
                {plays[c.id]
                  ? `Plays: ${plays[c.id].plays} · Avg watch: ${plays[c.id].avgWatchSec}s · Completion: ${Math.round((plays[c.id].completionRate ?? 0) * 100)}%`
                  : 'Plays: —'}
              </p>
              {(c.ads ?? []).filter((ad) => ad.amount).map((ad) => (
                <p key={ad.id} className="hint">
                  {ad.name || ad.id}: spent ₹{(adSpend[ad.id]?.spend ?? 0).toFixed(2)} of ₹{Number(ad.amount).toFixed(2)}
                  {(adSpend[ad.id]?.spend ?? 0) >= Number(ad.amount) ? ' — exhausted, house ads now filling this slot' : ''}
                </p>
              ))}
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
