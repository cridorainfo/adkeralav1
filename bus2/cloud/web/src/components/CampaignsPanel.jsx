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
  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [editForm, setEditForm] = useState({});
  const [editOpen, setEditOpen] = useState(null);
  const [editUploadingSlot, setEditUploadingSlot] = useState({});

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
    setShowCreateForm(false);
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
    const slot = isBanner ? 'banner' : 'fullscreen';
    setUploadingSlot(slot);
    setMessage(`Uploading ${file.name}…`);
    try {
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
      setMessage(`Uploaded ${file.name}`);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    } finally {
      setUploadingSlot(null);
    }
  }

  // Editing reuses the campaign's existing id and every kept ad's existing id — play history
  // (adPlays is keyed by adId/campaignId, see cloud/store.js) is an independent append-only log,
  // so nothing about it is touched by PUT /api/campaigns/:id. Only ads the admin removes here
  // lose their future rotation slot; their historical plays/report stay exactly as they were.
  function openEdit(c) {
    setEditOpen(c.id);
    setEditForm({
      ...editForm,
      [c.id]: {
        name: c.name,
        targetBusIds: [...(c.targetBusIds ?? [])],
        ads: (c.ads ?? []).map((ad) => ({ ...ad })),
        bannerAds: (c.bannerAds ?? []).map((ad) => ({ ...ad })),
        pendingAmount: '',
        pendingTriggerStopEn: '',
      },
    });
  }

  function closeEdit() {
    setEditOpen(null);
  }

  function updateEditField(campaignId, field, value) {
    setEditForm({
      ...editForm,
      [campaignId]: { ...editForm[campaignId], [field]: value },
    });
  }

  function toggleEditBus(campaignId, busId) {
    const current = editForm[campaignId];
    const ids = current.targetBusIds.includes(busId)
      ? current.targetBusIds.filter((id) => id !== busId)
      : [...current.targetBusIds, busId];
    updateEditField(campaignId, 'targetBusIds', ids);
  }

  function updateEditAdField(campaignId, key, adId, field, value) {
    const current = editForm[campaignId];
    setEditForm({
      ...editForm,
      [campaignId]: {
        ...current,
        [key]: current[key].map((ad) => (ad.id === adId ? { ...ad, [field]: value } : ad)),
      },
    });
  }

  function removeEditAd(campaignId, key, adId) {
    const current = editForm[campaignId];
    setEditForm({
      ...editForm,
      [campaignId]: { ...current, [key]: current[key].filter((ad) => ad.id !== adId) },
    });
  }

  async function uploadEditAd(campaignId, file, isBanner) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const slot = isBanner ? 'banner' : 'fullscreen';
    setEditUploadingSlot({ ...editUploadingSlot, [campaignId]: slot });
    setMessage(`Uploading ${file.name}…`);
    try {
      const category = isBanner ? 'banners' : 'ads';
      const up = await uploadMedia(file, category);
      const key = isBanner ? 'bannerAds' : 'ads';
      const current = editForm[campaignId];
      const item = {
        id: `${isBanner ? 'banner' : 'ad'}-${Date.now()}`,
        name: file.name,
        type: adMediaTypeFromFile(file),
        mediaFile: up.path,
        durationSec: isBanner ? 8 : 12,
        ...(current.pendingAmount ? { amount: Number(current.pendingAmount) } : {}),
        ...(!isBanner && current.pendingTriggerStopEn ? { triggerStopEn: current.pendingTriggerStopEn } : {}),
      };
      setEditForm({
        ...editForm,
        [campaignId]: {
          ...current,
          [key]: [...current[key], item],
          pendingAmount: '',
          ...(!isBanner ? { pendingTriggerStopEn: '' } : {}),
        },
      });
      setMessage(`Uploaded ${file.name}`);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    } finally {
      setEditUploadingSlot({ ...editUploadingSlot, [campaignId]: null });
    }
  }

  // Saves the edit, then — if the campaign is active — immediately re-pushes the updated ads to
  // its target buses so the new content actually resumes playing rather than waiting for a
  // separate manual "Push to buses" click. Paused/pending campaigns just save; they'll pick up
  // the edited ads whenever they're next pushed or approved.
  async function submitEdit(campaignId) {
    const edit = editForm[campaignId];
    if (!edit) return;
    setMessage('');
    try {
      const result = await api(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: edit.name,
          targetBusIds: edit.targetBusIds,
          ads: edit.ads,
          bannerAds: edit.bannerAds,
        }),
      });
      if (result.campaign?.status === 'active') {
        await api(`/api/campaigns/${encodeURIComponent(campaignId)}/push`, { method: 'POST' });
        setMessage('Campaign updated — resumed on buses');
      } else {
        setMessage('Campaign updated');
      }
      setEditOpen(null);
      load();
    } catch (err) {
      setMessage(err.message ?? 'Update failed');
    }
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

  const canManage = user?.role === 'advertiser' || adminMode;

  const groups = {
    pending: campaigns.filter((c) => !c.completed && c.status === 'pending'),
    active: campaigns.filter((c) => !c.completed && c.status === 'active'),
    paused: campaigns.filter((c) => !c.completed && c.status === 'paused'),
    completed: campaigns.filter((c) => c.completed),
  };
  const filterTabs = [
    { key: 'all', label: 'All', count: campaigns.length },
    { key: 'pending', label: 'Pending', count: groups.pending.length },
    { key: 'active', label: 'Active', count: groups.active.length },
    { key: 'paused', label: 'Paused', count: groups.paused.length },
    { key: 'completed', label: 'Completed', count: groups.completed.length },
  ];
  const visibleCampaigns = statusFilter === 'all' ? campaigns : groups[statusFilter] ?? [];

  return (
    <>
      {canManage && (
        <div className="card">
          <div className="campaigns-header">
            <h2>{adminMode ? 'All campaigns' : 'My campaigns'}</h2>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowCreateForm((v) => !v)}
            >
              {showCreateForm ? 'Cancel' : '+ New campaign'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={createCampaign} className="campaign-create-form">
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
                <input
                  type="file"
                  accept={AD_MEDIA_ACCEPT}
                  disabled={uploadingSlot === 'fullscreen'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) uploadAd(file, false);
                  }}
                />
                {uploadingSlot === 'fullscreen' && <small className="hint">Uploading…</small>}
              </div>
              <div className="form-group">
                <label>Banner ad media (image or video)</label>
                <input
                  type="file"
                  accept={AD_MEDIA_ACCEPT}
                  disabled={uploadingSlot === 'banner'}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) uploadAd(file, true);
                  }}
                />
                {uploadingSlot === 'banner' && <small className="hint">Uploading…</small>}
              </div>
              <button type="submit" className="btn btn-primary btn-sm">
                Create campaign
              </button>
            </form>
          )}
          {message && <p className="hint">{message}</p>}

          <div className="campaign-filter-tabs">
            {filterTabs.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`campaign-filter-tab${statusFilter === f.key ? ' active' : ''}`}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label} <span className="campaign-filter-count">{f.count}</span>
              </button>
            ))}
          </div>

          {!visibleCampaigns.length && <p className="empty-state">No campaigns here.</p>}

          {visibleCampaigns.map((c) => (
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
              reports={reports}
              expandedReport={expandedReport}
              toggleReport={toggleReport}
              rerunOpen={rerunOpen}
              openRerun={openRerun}
              rerunForm={rerunForm}
              updateRerunAmount={updateRerunAmount}
              submitRerun={submitRerun}
              editOpen={editOpen}
              editForm={editForm}
              openEdit={openEdit}
              closeEdit={closeEdit}
              updateEditField={updateEditField}
              toggleEditBus={toggleEditBus}
              updateEditAdField={updateEditAdField}
              removeEditAd={removeEditAd}
              uploadEditAd={uploadEditAd}
              editUploadingSlot={editUploadingSlot}
              submitEdit={submitEdit}
            />
          ))}
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
  reports = {},
  expandedReport,
  toggleReport,
  rerunOpen,
  openRerun,
  rerunForm = {},
  updateRerunAmount,
  submitRerun,
  editOpen,
  editForm = {},
  openEdit,
  closeEdit,
  updateEditField,
  toggleEditBus,
  updateEditAdField,
  removeEditAd,
  uploadEditAd,
  editUploadingSlot = {},
  submitEdit,
}) {
  const completed = Boolean(c.completed);
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
  const edit = editForm[c.id];
  const editSlot = editUploadingSlot[c.id];
  const targetLabels = (c.targetBusIds ?? []).map((id) =>
    busDisplayLabel(buses.find((b) => b.busId === id) ?? { busId: id })
  );
  const playStats = plays[c.id];

  return (
    <div className="campaign-card">
      <div className="campaign-card-header">
        <div>
          <h3 className="campaign-card-title">{c.name}</h3>
          <div className="campaign-card-targets">
            {targetLabels.length ? (
              targetLabels.map((label, i) => (
                <span key={i} className="bus-pill">{label}</span>
              ))
            ) : (
              <span className="hint">No target buses</span>
            )}
          </div>
        </div>
        <div className="campaign-card-badges">
          <span className={`campaign-status ${c.status}`}>{c.status}</span>
          {completed && <span className="campaign-status completed">completed</span>}
        </div>
      </div>

      {(c.ads?.length > 0 || c.bannerAds?.length > 0) && (
        <div className="campaign-card-thumbs">
          {(c.ads ?? []).map((ad) => (
            <AdMediaPreview key={ad.id} ad={ad} format="fullscreen" />
          ))}
          {(c.bannerAds ?? []).map((ad) => (
            <AdMediaPreview key={ad.id} ad={ad} format="banner" />
          ))}
        </div>
      )}

      <div className="campaign-card-stats">
        <span>{c.ads?.length ?? 0} fullscreen</span>
        <span>{c.bannerAds?.length ?? 0} banner</span>
        <span>{linkedAudioAds.length} audio stop-ad</span>
        {playStats && (
          <>
            <span>{playStats.plays} plays</span>
            <span>{playStats.avgWatchSec}s avg watch</span>
            <span>{Math.round((playStats.completionRate ?? 0) * 100)}% completion</span>
          </>
        )}
      </div>

      {budgetedAds.length > 0 && (
        <div className="campaign-card-budgets">
          {budgetedAds.map((ad) => {
            const spend = adSpend[ad.id]?.spend ?? 0;
            const amount = Number(ad.amount) || 0;
            const pct = amount > 0 ? Math.min(100, (spend / amount) * 100) : 0;
            const exhausted = spend >= amount;
            return (
              <div key={ad.id}>
                <div className="budget-row-label">
                  <span>{ad.name || ad.audioFile || ad.id}</span>
                  <span>
                    ₹{spend.toFixed(2)} / ₹{amount.toFixed(2)}
                    {exhausted ? ' — exhausted' : ''}
                  </span>
                </div>
                <div className="budget-bar">
                  <div
                    className={`budget-bar-fill${exhausted ? ' exhausted' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adminMode && (
        <details className="campaign-audio-attach">
          <summary>Attach audio stop-ad</summary>
          <div className="inline-form" style={{ marginTop: '0.5rem' }}>
            <div className="form-group">
              <label>Stop voice ad</label>
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
        </details>
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
        {adminMode && !completed && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => (editOpen === c.id ? closeEdit() : openEdit(c))}
          >
            {editOpen === c.id ? 'Cancel edit' : 'Edit'}
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

      {adminMode && editOpen === c.id && edit && (
        <div className="card campaign-edit-form" style={{ marginTop: '0.5rem' }}>
          <h4>Edit campaign</h4>
          <p className="hint">
            Views and plays recorded so far stay attached to this campaign — saving only changes
            what's shown from here on. If the campaign is active, saving immediately pushes the
            updated ads back out to its buses.
          </p>
          <div className="form-group">
            <label>Campaign name</label>
            <input value={edit.name} onChange={(e) => updateEditField(c.id, 'name', e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Target buses</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {buses.map((b) => (
                <label key={b.busId} style={{ fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={edit.targetBusIds.includes(b.busId)}
                    onChange={() => toggleEditBus(c.id, b.busId)}
                  />{' '}
                  {busDisplayLabel(b)}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Fullscreen ads</label>
            {edit.ads.map((ad) => (
              <div key={ad.id} className="edit-ad-row">
                <AdMediaPreview ad={ad} format="fullscreen" />
                <input
                  type="text"
                  value={ad.name}
                  onChange={(e) => updateEditAdField(c.id, 'ads', ad.id, 'name', e.target.value)}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Budget ₹"
                  value={ad.amount ?? ''}
                  onChange={(e) => updateEditAdField(c.id, 'ads', ad.id, 'amount', e.target.value ? Number(e.target.value) : undefined)}
                  style={{ width: '6rem' }}
                />
                <input
                  type="text"
                  placeholder="Trigger stop"
                  value={ad.triggerStopEn ?? ''}
                  onChange={(e) => updateEditAdField(c.id, 'ads', ad.id, 'triggerStopEn', e.target.value)}
                  style={{ width: '8rem' }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeEditAd(c.id, 'ads', ad.id)}>
                  Remove
                </button>
              </div>
            ))}
            <input
              type="file"
              accept={AD_MEDIA_ACCEPT}
              disabled={editSlot === 'fullscreen'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) uploadEditAd(c.id, file, false);
              }}
            />
            {editSlot === 'fullscreen' && <small className="hint">Uploading…</small>}
          </div>

          <div className="form-group">
            <label>Banner ads</label>
            {edit.bannerAds.map((ad) => (
              <div key={ad.id} className="edit-ad-row">
                <AdMediaPreview ad={ad} format="banner" />
                <input
                  type="text"
                  value={ad.name}
                  onChange={(e) => updateEditAdField(c.id, 'bannerAds', ad.id, 'name', e.target.value)}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Budget ₹"
                  value={ad.amount ?? ''}
                  onChange={(e) => updateEditAdField(c.id, 'bannerAds', ad.id, 'amount', e.target.value ? Number(e.target.value) : undefined)}
                  style={{ width: '6rem' }}
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeEditAd(c.id, 'bannerAds', ad.id)}>
                  Remove
                </button>
              </div>
            ))}
            <input
              type="file"
              accept={AD_MEDIA_ACCEPT}
              disabled={editSlot === 'banner'}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) uploadEditAd(c.id, file, true);
              }}
            />
            {editSlot === 'banner' && <small className="hint">Uploading…</small>}
          </div>

          <button type="button" className="btn btn-primary btn-sm" onClick={() => submitEdit(c.id)}>
            Save changes
          </button>
        </div>
      )}

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
