import { useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { doubleConfirm } from '../lib/confirm.js';
import { AD_MEDIA_ACCEPT, validateAdMediaFile, adMediaTypeFromFile } from '../lib/adMedia.js';
import { busDisplayLabel } from './BusContext.jsx';
import AdMediaPreview from './AdMediaPreview.jsx';

/**
 * Entertainment/tourist-bus media playlists — deliberately mirrors CampaignsPanel.jsx's create/
 * edit/target/push shape (same "author once, target a set of buses, push" pipeline), simplified:
 * no budget/quota, no advertiser role, no audio stop-ads, no completed/rerun lifecycle — a
 * schedule is just always active and loops until you change it.
 */
export default function SchedulesPanel() {
  const [schedules, setSchedules] = useState([]);
  const [buses, setBuses] = useState([]);
  const [form, setForm] = useState({
    name: '',
    targetBusIds: [],
    items: [],
    showFullscreenAds: true,
    showBannerAds: true,
  });
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editOpen, setEditOpen] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editUploading, setEditUploading] = useState(null);

  async function load() {
    const [sJson, bJson] = await Promise.all([api('/api/schedules'), api('/api/buses')]);
    setSchedules(sJson.schedules ?? []);
    setBuses(bJson.buses ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  function toggleBus(busId) {
    const ids = form.targetBusIds.includes(busId)
      ? form.targetBusIds.filter((id) => id !== busId)
      : [...form.targetBusIds, busId];
    setForm({ ...form, targetBusIds: ids });
  }

  async function uploadItem(file) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setUploading(true);
    setMessage(`Uploading ${file.name}…`);
    try {
      const up = await uploadMedia(file, 'schedule');
      const item = {
        id: `item-${Date.now()}`,
        mediaFile: up.path,
        kind: adMediaTypeFromFile(file),
        order: form.items.length,
        durationSec: null,
      };
      setForm({ ...form, items: [...form.items, item] });
      setMessage(`Added ${file.name}`);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function removeItem(id) {
    setForm({ ...form, items: form.items.filter((i) => i.id !== id) });
  }

  async function createSchedule(e) {
    e.preventDefault();
    setMessage('');
    await api('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setForm({ name: '', targetBusIds: [], items: [], showFullscreenAds: true, showBannerAds: true });
    setMessage('Schedule created — push it to make it live on those buses');
    setShowCreateForm(false);
    load();
  }

  async function push(id) {
    setMessage('');
    try {
      const result = await api(`/api/schedules/${encodeURIComponent(id)}/push`, { method: 'POST' });
      setMessage(`Pushed to ${result.queued?.length ?? 0} bus(es)`);
      load();
    } catch (err) {
      setMessage(err.message ?? 'Push failed');
    }
  }

  // Deleting also purges the schedule's media files server-side, unless still used elsewhere
  // (e.g. another schedule sharing an upload, or a bus catalog that hasn't re-synced yet) — see
  // DELETE /api/schedules/:id in server.js.
  async function removeSchedule(s) {
    const ok = doubleConfirm(
      `Delete schedule "${s.name}"? Its ${s.items?.length ?? 0} media file(s) will be removed from the server too, unless still used elsewhere.`,
      'This deletes the schedule permanently. Continue?'
    );
    if (!ok) return;
    setMessage('');
    try {
      await api(`/api/schedules/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
      setMessage('Schedule deleted');
      load();
    } catch (err) {
      setMessage(err.message ?? 'Delete failed');
    }
  }

  function openEdit(s) {
    setEditOpen(s.id);
    setEditForm({
      ...editForm,
      [s.id]: {
        name: s.name,
        targetBusIds: [...(s.targetBusIds ?? [])],
        items: (s.items ?? []).map((i) => ({ ...i })),
        showFullscreenAds: s.showFullscreenAds !== false,
        showBannerAds: s.showBannerAds !== false,
      },
    });
  }

  function closeEdit() {
    setEditOpen(null);
  }

  function updateEditField(id, field, value) {
    setEditForm({ ...editForm, [id]: { ...editForm[id], [field]: value } });
  }

  function toggleEditBus(id, busId) {
    const current = editForm[id];
    const ids = current.targetBusIds.includes(busId)
      ? current.targetBusIds.filter((x) => x !== busId)
      : [...current.targetBusIds, busId];
    updateEditField(id, 'targetBusIds', ids);
  }

  function removeEditItem(id, itemId) {
    const current = editForm[id];
    updateEditField(id, 'items', current.items.filter((i) => i.id !== itemId));
  }

  async function uploadEditItem(id, file) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    setEditUploading(id);
    setMessage(`Uploading ${file.name}…`);
    try {
      const up = await uploadMedia(file, 'schedule');
      const current = editForm[id];
      const item = {
        id: `item-${Date.now()}`,
        mediaFile: up.path,
        kind: adMediaTypeFromFile(file),
        order: current.items.length,
        durationSec: null,
      };
      updateEditField(id, 'items', [...current.items, item]);
      setMessage(`Added ${file.name}`);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    } finally {
      setEditUploading(null);
    }
  }

  // Saving immediately re-pushes to whatever buses are (still) targeted, so an edit takes effect
  // right away instead of waiting for the next periodic pull — same reasoning as
  // CampaignsPanel.jsx's submitEdit for active campaigns.
  async function submitEdit(id) {
    const edit = editForm[id];
    if (!edit) return;
    setMessage('');
    try {
      await api(`/api/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(edit) });
      await api(`/api/schedules/${encodeURIComponent(id)}/push`, { method: 'POST' });
      setMessage('Schedule updated and pushed');
      setEditOpen(null);
      load();
    } catch (err) {
      setMessage(err.message ?? 'Update failed');
    }
  }

  function busLoopStatus(busId) {
    const bus = buses.find((b) => b.busId === busId);
    const t = bus?.telemetry;
    if (!t || t.scheduleItemCount == null) return null;
    return {
      loopCount: t.scheduleLoopCount ?? 0,
      currentIndex: t.scheduleCurrentIndex ?? 0,
      itemCount: t.scheduleItemCount ?? 0,
      mode: bus?.profile?.mode,
    };
  }

  return (
    <div className="card">
      <div className="campaigns-header">
        <h2>Schedules</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowCreateForm((v) => !v)}>
          {showCreateForm ? 'Cancel' : '+ New schedule'}
        </button>
      </div>
      <p className="hint">
        For entertainment/tourist buses — a looping media playlist instead of route/stop
        announcements. Mark a bus "entertainment" below to make it show a schedule; ads and
        banners still play on top exactly like route buses, controlled by the toggles here.
      </p>

      {showCreateForm && (
        <form onSubmit={createSchedule} className="campaign-create-form">
          <div className="form-group">
            <label>Schedule name</label>
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
                  {b.profile?.mode !== 'entertainment' && (
                    <span className="hint"> (currently route mode)</span>
                  )}
                </label>
              ))}
            </div>
            <p className="hint">
              Targeting a bus here doesn't switch its mode — set each bus to "entertainment" in
              the Fleet tab too, or it'll download this content but keep showing its route.
            </p>
          </div>
          <div className="inline-form">
            <label style={{ fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={form.showFullscreenAds}
                onChange={(e) => setForm({ ...form, showFullscreenAds: e.target.checked })}
              />{' '}
              Show fullscreen ads
            </label>
            <label style={{ fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={form.showBannerAds}
                onChange={(e) => setForm({ ...form, showBannerAds: e.target.checked })}
              />{' '}
              Show banner ads
            </label>
          </div>
          <div className="form-group">
            <label>Playlist items ({form.items.length})</label>
            {form.items.map((item, i) => (
              <div key={item.id} className="edit-ad-row">
                <span className="hint">{i + 1}.</span>
                <AdMediaPreview ad={{ ...item, type: item.kind }} format="fullscreen" />
                <span style={{ flex: 1 }}>{item.mediaFile.split('/').pop()}</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeItem(item.id)}>
                  Remove
                </button>
              </div>
            ))}
            <input
              type="file"
              accept={AD_MEDIA_ACCEPT}
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) uploadItem(file);
              }}
            />
            {uploading && <small className="hint">Uploading…</small>}
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!form.items.length}>
            Create schedule
          </button>
        </form>
      )}
      {message && <p className="hint">{message}</p>}

      {!schedules.length && <p className="empty-state">No schedules yet.</p>}

      {schedules.map((s) => {
        const edit = editForm[s.id];
        const editSlot = editUploading === s.id;
        const targetLabels = (s.targetBusIds ?? []).map((id) =>
          busDisplayLabel(buses.find((b) => b.busId === id) ?? { busId: id })
        );
        return (
          <div key={s.id} className="campaign-card">
            <div className="campaign-card-header">
              <div>
                <h3 className="campaign-card-title">{s.name}</h3>
                <div className="campaign-card-targets">
                  {targetLabels.length ? (
                    targetLabels.map((label, i) => <span key={i} className="bus-pill">{label}</span>)
                  ) : (
                    <span className="hint">No target buses</span>
                  )}
                </div>
              </div>
            </div>

            {s.items?.length > 0 && (
              <div className="campaign-card-thumbs">
                {s.items.map((item) => (
                  <AdMediaPreview key={item.id} ad={{ ...item, type: item.kind }} format="fullscreen" />
                ))}
              </div>
            )}

            <div className="campaign-card-stats">
              <span>{s.items?.length ?? 0} item(s)</span>
              <span>fullscreen ads {s.showFullscreenAds !== false ? 'on' : 'off'}</span>
              <span>banner ads {s.showBannerAds !== false ? 'on' : 'off'}</span>
            </div>

            {(s.targetBusIds ?? []).length > 0 && (
              <div className="campaign-card-stats">
                {s.targetBusIds.map((busId) => {
                  const status = busLoopStatus(busId);
                  const label = busDisplayLabel(buses.find((b) => b.busId === busId) ?? { busId });
                  if (!status) return <span key={busId}>{label}: not reporting yet</span>;
                  return (
                    <span key={busId}>
                      {label}: item {status.currentIndex + 1}/{status.itemCount}, looped{' '}
                      {status.loopCount}×
                      {status.mode !== 'entertainment' ? ' (bus not in entertainment mode)' : ''}
                    </span>
                  );
                })}
              </div>
            )}

            <div className="editor-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => push(s.id)}>
                Push to buses
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => (editOpen === s.id ? closeEdit() : openEdit(s))}
              >
                {editOpen === s.id ? 'Cancel edit' : 'Edit'}
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => removeSchedule(s)}>
                Delete
              </button>
            </div>

            {editOpen === s.id && edit && (
              <div className="card campaign-edit-form" style={{ marginTop: '0.5rem' }}>
                <h4>Edit schedule</h4>
                <div className="form-group">
                  <label>Schedule name</label>
                  <input value={edit.name} onChange={(e) => updateEditField(s.id, 'name', e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Target buses</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {buses.map((b) => (
                      <label key={b.busId} style={{ fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={edit.targetBusIds.includes(b.busId)}
                          onChange={() => toggleEditBus(s.id, b.busId)}
                        />{' '}
                        {busDisplayLabel(b)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="inline-form">
                  <label style={{ fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={edit.showFullscreenAds}
                      onChange={(e) => updateEditField(s.id, 'showFullscreenAds', e.target.checked)}
                    />{' '}
                    Show fullscreen ads
                  </label>
                  <label style={{ fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={edit.showBannerAds}
                      onChange={(e) => updateEditField(s.id, 'showBannerAds', e.target.checked)}
                    />{' '}
                    Show banner ads
                  </label>
                </div>
                <div className="form-group">
                  <label>Playlist items ({edit.items.length})</label>
                  {edit.items.map((item, i) => (
                    <div key={item.id} className="edit-ad-row">
                      <span className="hint">{i + 1}.</span>
                      <AdMediaPreview ad={{ ...item, type: item.kind }} format="fullscreen" />
                      <span style={{ flex: 1 }}>{item.mediaFile.split('/').pop()}</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeEditItem(s.id, item.id)}>
                        Remove
                      </button>
                    </div>
                  ))}
                  <input
                    type="file"
                    accept={AD_MEDIA_ACCEPT}
                    disabled={editSlot}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) uploadEditItem(s.id, file);
                    }}
                  />
                  {editSlot && <small className="hint">Uploading…</small>}
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => submitEdit(s.id)}>
                  Save + push
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
