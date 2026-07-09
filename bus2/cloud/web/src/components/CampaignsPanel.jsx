import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { uploadMedia } from '../lib/api.js';
import { AD_MEDIA_ACCEPT, validateAdMediaFile, adMediaTypeFromFile } from '../lib/adMedia.js';
import { busDisplayLabel } from './BusContext.jsx';
import AdMediaPreview from './AdMediaPreview.jsx';

export default function CampaignsPanel({ adminMode = false }) {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [buses, setBuses] = useState([]);
  const [form, setForm] = useState({ name: '', targetBusIds: [], pendingAmount: '', pendingTriggerStopEn: '' });
  const [message, setMessage] = useState('');
  const [plays, setPlays] = useState({});
  const [adSpend, setAdSpend] = useState({});
  const [stopVoiceAds, setStopVoiceAds] = useState({});
  const [audioAttach, setAudioAttach] = useState({});
  const [reports, setReports] = useState({});
  const [expandedReport, setExpandedReport] = useState(null);
  const [rerunForm, setRerunForm] = useState({});
  const [rerunOpen, setRerunOpen] = useState(null);

  async function load() {
    const [cJson, bJson, vJson] = await Promise.all([
      api('/api/campaigns'),
      api('/api/buses'),
      api('/api/stops/voice-ads/catalog').catch(() => null),
    ]);
    const loadedCampaigns = cJson.campaigns ?? [];
    setCampaigns(loadedCampaigns);
    setBuses(bJson.buses ?? []);
    if (vJson) setStopVoiceAds(vJson.stopVoiceAds ?? {});

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

    // Per-ad spend vs budget — fullscreen, banner, and linked audio stop-ads all carry a
    // budget/exhaustion concept now (see cloud/pricing.js's format-aware computeAdSpend).
    const linkedAudioAds = Object.values(vJson?.stopVoiceAds ?? {}).filter((ad) =>
      loadedCampaigns.some((c) => c.id === ad.campaignId)
    );
    const budgetedAds = [
      ...loadedCampaigns.flatMap((c) => (c.ads ?? []).filter((ad) => ad.amount)),
      ...loadedCampaigns.flatMap((c) => (c.bannerAds ?? []).filter((ad) => ad.amount)),
      ...linkedAudioAds.filter((ad) => ad.amount),
    ];
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
      // Budget applies to both fullscreen and banner ads now (both are play-tracked and
      // priced — see cloud/pricing.js). Stop-trigger stays fullscreen-only, banners just show
      // in the fixed strip regardless of approaching stop.
      ...(form.pendingAmount ? { amount: Number(form.pendingAmount) } : {}),
      ...(!isBanner && form.pendingTriggerStopEn ? { triggerStopEn: form.pendingTriggerStopEn } : {}),
    };
    setForm({
      ...form,
      [key]: [...(form[key] ?? []), item],
      pendingAmount: '',
      ...(!isBanner ? { pendingTriggerStopEn: '' } : {}),
    });
  }

  // Fetched on-demand (not eagerly for every completed campaign) — the per-bus/per-route
  // breakdown is heavier than the plays summary above, and most completed campaigns won't
  // have their report opened every page load.
  async function toggleReport(campaignId) {
    if (expandedReport === campaignId) {
      setExpandedReport(null);
      return;
    }
    setExpandedReport(campaignId);
    if (reports[campaignId]) return;
    try {
      const json = await api(`/api/campaigns/${encodeURIComponent(campaignId)}/report`);
      setReports({ ...reports, [campaignId]: json });
    } catch (err) {
      setMessage(err.message ?? 'Could not load report');
    }
  }

  function openRerun(c) {
    setRerunOpen(c.id);
    setRerunForm({
      ...rerunForm,
      [c.id]: {
        ads: (c.ads ?? []).map((ad) => ({ adId: ad.id, name: ad.name || ad.id, amount: ad.amount ?? '' })),
        bannerAds: (c.bannerAds ?? []).map((ad) => ({ adId: ad.id, name: ad.name || ad.id, amount: ad.amount ?? '' })),
      },
    });
  }

  function updateRerunAmount(campaignId, key, adId, amount) {
    const current = rerunForm[campaignId];
    setRerunForm({
      ...rerunForm,
      [campaignId]: {
        ...current,
        [key]: current[key].map((row) => (row.adId === adId ? { ...row, amount } : row)),
      },
    });
  }

  async function submitRerun(campaignId) {
    const entry = rerunForm[campaignId];
    if (!entry) return;
    await api(`/api/campaigns/${encodeURIComponent(campaignId)}/rerun`, {
      method: 'POST',
      body: JSON.stringify({
        ads: entry.ads.filter((row) => row.amount).map((row) => ({ adId: row.adId, amount: Number(row.amount) })),
        bannerAds: entry.bannerAds.filter((row) => row.amount).map((row) => ({ adId: row.adId, amount: Number(row.amount) })),
      }),
    });
    setRerunOpen(null);
    setMessage('Campaign rerun with new budget');
    load();
  }

  async function attachAudioAd(campaignId, stopKey, amount) {
    if (!stopKey) return;
    const entry = stopVoiceAds[stopKey];
    if (!entry) return;
    const next = {
      ...stopVoiceAds,
      [stopKey]: { ...entry, campaignId, amount: Number(amount) || undefined },
    };
    await api('/api/stops/voice-ads', { method: 'PUT', body: JSON.stringify({ stopVoiceAds: next }) });
    setMessage('Audio stop-ad attached to campaign');
    load();
  }

  function toggleBus(busId) {
    const ids = form.targetBusIds.includes(busId)
      ? form.targetBusIds.filter((id) => id !== busId)
      : [...form.targetBusIds, busId];
    setForm({ ...form, targetBusIds: ids });
  }

  const activeCampaigns = campaigns.filter((c) => !c.completed);
  const completedCampaigns = campaigns.filter((c) => c.completed);

  return (
    <>
      {(user?.role === 'advertiser' || adminMode) && (
        <div className="card">
          <h2>{adminMode ? 'All campaigns' : 'My campaigns'}</h2>
          {(user?.role === 'advertiser' || adminMode) && (
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
                        {busDisplayLabel(b)}
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
          <h3>Active / pending / paused</h3>
          {activeCampaigns.map((c) => (
            <CampaignCard
              key={c.id}
              c={c}
              buses={buses}
              stopVoiceAds={stopVoiceAds}
              adSpend={adSpend}
              plays={plays}
              adminMode={adminMode}
              user={user}
              audioAttach={audioAttach}
              setAudioAttach={setAudioAttach}
              attachAudioAd={attachAudioAd}
              approve={approve}
              push={push}
            />
          ))}
          {!activeCampaigns.length && <p className="empty-state">No active campaigns.</p>}

          {completedCampaigns.length > 0 && (
            <>
              <h3>Completed</h3>
              <p className="hint">
                Every budgeted ad in these campaigns has spent through its amount. Rerun with a
                new budget to start a fresh campaign — the report and history here stay exactly
                as they are.
              </p>
              {completedCampaigns.map((c) => (
                <CampaignCard
                  key={c.id}
                  c={c}
                  buses={buses}
                  stopVoiceAds={stopVoiceAds}
                  adSpend={adSpend}
                  plays={plays}
                  adminMode={adminMode}
                  user={user}
                  audioAttach={audioAttach}
                  setAudioAttach={setAudioAttach}
                  attachAudioAd={attachAudioAd}
                  approve={approve}
                  push={push}
                  completed
                  reports={reports}
                  expandedReport={expandedReport}
                  toggleReport={toggleReport}
                  rerunOpen={rerunOpen}
                  openRerun={openRerun}
                  rerunForm={rerunForm}
                  updateRerunAmount={updateRerunAmount}
                  submitRerun={submitRerun}
                />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

function CampaignCard({
  c,
  buses,
  stopVoiceAds,
  adSpend,
  plays,
  adminMode,
  user,
  audioAttach,
  setAudioAttach,
  attachAudioAd,
  approve,
  push,
  completed = false,
  reports,
  expandedReport,
  toggleReport,
  rerunOpen,
  openRerun,
  rerunForm,
  updateRerunAmount,
  submitRerun,
}) {
  const linkedAudioAds = Object.entries(stopVoiceAds).filter(([, ad]) => ad.campaignId === c.id);
  const budgetedAds = [
    ...(c.ads ?? []).filter((ad) => ad.amount),
    ...(c.bannerAds ?? []).filter((ad) => ad.amount),
    ...linkedAudioAds.filter(([, ad]) => ad.amount).map(([, ad]) => ad),
  ];
  const availableStops = Object.entries(stopVoiceAds).filter(
    ([, ad]) => !ad.campaignId || ad.campaignId === c.id
  );
  const report = reports[c.id];
  const rerun = rerunForm[c.id];

  return (
    <div className="campaign-card">
      <strong>{c.name}</strong>{' '}
      <span className={`campaign-status ${c.status}`}>{c.status}</span>{' '}
      {completed && <span className="campaign-status completed">completed</span>}
      <p className="hint">
        {c.ads?.length ?? 0} fullscreen · {c.bannerAds?.length ?? 0} banner ·{' '}
        {linkedAudioAds.length} audio stop-ad · targets:{' '}
        {(c.targetBusIds ?? [])
          .map((id) => busDisplayLabel(buses.find((b) => b.busId === id) ?? { busId: id }))
          .join(', ') || 'none'}
      </p>

      {(c.ads?.length > 0 || c.bannerAds?.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '0.5rem 0' }}>
          {(c.ads ?? []).map((ad) => (
            <AdMediaPreview key={ad.id} ad={ad} format="fullscreen" />
          ))}
          {(c.bannerAds ?? []).map((ad) => (
            <AdMediaPreview key={ad.id} ad={ad} format="banner" />
          ))}
        </div>
      )}

      <p className="hint">
        {plays[c.id]
          ? `Plays: ${plays[c.id].plays} · Avg watch: ${plays[c.id].avgWatchSec}s · Completion: ${Math.round((plays[c.id].completionRate ?? 0) * 100)}%`
          : 'Plays: —'}
      </p>
      {budgetedAds.map((ad) => (
        <p key={ad.id} className="hint">
          {ad.name || ad.audioFile || ad.id}: spent ₹{(adSpend[ad.id]?.spend ?? 0).toFixed(2)} of ₹{Number(ad.amount).toFixed(2)}
          {(adSpend[ad.id]?.spend ?? 0) >= Number(ad.amount) ? ' — exhausted' : ''}
        </p>
      ))}
      {adminMode && (
        <div className="inline-form">
          <div className="form-group">
            <label>Attach audio stop-ad</label>
            <select
              value={audioAttach[c.id]?.stopKey ?? ''}
              onChange={(e) =>
                setAudioAttach({ ...audioAttach, [c.id]: { ...audioAttach[c.id], stopKey: e.target.value } })
              }
            >
              <option value="">Select a stop voice ad…</option>
              {availableStops.map(([key, ad]) => (
                <option key={key} value={key}>
                  {key}{ad.campaignId === c.id ? ' (attached)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Amount (₹)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={audioAttach[c.id]?.amount ?? ''}
              onChange={(e) =>
                setAudioAttach({ ...audioAttach, [c.id]: { ...audioAttach[c.id], amount: e.target.value } })
              }
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => attachAudioAd(c.id, audioAttach[c.id]?.stopKey, audioAttach[c.id]?.amount)}
          >
            Attach
          </button>
        </div>
      )}
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
        {completed && adminMode && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => toggleReport(c.id)}>
              {expandedReport === c.id ? 'Hide report' : 'View report'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openRerun(c)}>
              Rerun with new budget
            </button>
          </>
        )}
      </div>

      {completed && expandedReport === c.id && (
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <h4>Report</h4>
          {!report && <p className="hint">Loading…</p>}
          {report?.byAd?.map((ad) => (
            <div key={ad.adId} style={{ marginBottom: '0.75rem' }}>
              <strong>{ad.name}</strong> <span className="hint">({ad.format}) — {ad.totalPlays} plays</span>
              <p className="hint">
                By bus:{' '}
                {ad.byBus.map((b) => `${busDisplayLabel(buses.find((bus) => bus.busId === b.busId) ?? { busId: b.busId })}: ${b.plays}`).join(', ') || '—'}
              </p>
              <p className="hint">
                By route:{' '}
                {ad.byRoute.map((r) => `${r.routeName}: ${r.plays}`).join(', ') || '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      {completed && rerunOpen === c.id && rerun && (
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <h4>Rerun with new budget</h4>
          {rerun.ads.map((row) => (
            <div key={row.adId} className="form-group">
              <label>{row.name} (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.amount}
                onChange={(e) => updateRerunAmount(c.id, 'ads', row.adId, e.target.value)}
              />
            </div>
          ))}
          {rerun.bannerAds.map((row) => (
            <div key={row.adId} className="form-group">
              <label>{row.name} — banner (₹)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={row.amount}
                onChange={(e) => updateRerunAmount(c.id, 'bannerAds', row.adId, e.target.value)}
              />
            </div>
          ))}
          <button type="button" className="btn btn-primary btn-sm" onClick={() => submitRerun(c.id)}>
            Start rerun
          </button>
        </div>
      )}
    </div>
  );
}
