import { useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { doubleConfirm } from '../lib/confirm.js';
import { AD_MEDIA_ACCEPT, validateAdMediaFile, adMediaTypeFromFile } from '../lib/adMedia.js';
import { WEEKDAY_OPTIONS, isScheduleWindowActive, describeScheduleWindow } from '../lib/scheduleWindow.js';
import { busDisplayLabel } from './BusContext.jsx';
import AdMediaPreview from './AdMediaPreview.jsx';

/** Day-of-week + optional date-range picker, shared by the create form and every edit panel —
 * `window` is {activeDays, startDate, endDate}, `onChange` receives the same shape back. */
function ScheduleWindowEditor({ window, onChange }) {
  const activeDays = window.activeDays ?? [];
  function toggleDay(key) {
    const next = activeDays.includes(key) ? activeDays.filter((d) => d !== key) : [...activeDays, key];
    onChange({ ...window, activeDays: next });
  }
  return (
    <div className="form-group">
      <label>Active window (optional)</label>
      <p className="hint" style={{ marginTop: 0 }}>
        Leave everything blank for "always active" (the original behavior). Pick days and/or a
        date range for e.g. a weekend-only tour playlist — set the target bus's Content mode to
        "Auto" in the Fleet tab so it switches to route view automatically outside this window.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
        {WEEKDAY_OPTIONS.map((d) => (
          <label key={d.key} style={{ fontSize: '0.85rem' }}>
            <input type="checkbox" checked={activeDays.includes(d.key)} onChange={() => toggleDay(d.key)} />{' '}
            {d.label}
          </label>
        ))}
      </div>
      <div className="inline-form">
        <div className="form-group">
          <label>Start date</label>
          <input
            type="date"
            value={window.startDate ?? ''}
            onChange={(e) => onChange({ ...window, startDate: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label>End date</label>
          <input
            type="date"
            value={window.endDate ?? ''}
            onChange={(e) => onChange({ ...window, endDate: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}

const UPLOAD_STATUS_LABEL = {
  pending: 'Queued',
  uploading: 'Uploading…',
  done: '✓ Uploaded',
  error: '✗ Failed',
};

const UPLOAD_STATUS_PILL_CLASS = {
  pending: 'version-unknown',
  uploading: 'version-outdated',
  done: 'version-current',
  error: 'version-below',
};

/** Per-file progress for the most recent multi-select upload — reused by both the create form's
 * `uploadQueue` and each edit panel's `editUploadQueue[scheduleId]`. */
function UploadStatusList({ queue }) {
  if (!queue?.length) return null;
  return (
    <div style={{ marginTop: '0.4rem' }}>
      {queue.map((row, i) => (
        <div key={i} className="edit-ad-row">
          <span style={{ flex: 1, fontSize: '0.85rem' }}>{row.name}</span>
          <span className={`version-pill ${UPLOAD_STATUS_PILL_CLASS[row.status]}`}>
            {row.status === 'error' && row.error ? `✗ ${row.error}` : UPLOAD_STATUS_LABEL[row.status]}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Entertainment/tourist-bus media playlists — deliberately mirrors CampaignsPanel.jsx's create/
 * edit/target/push shape (same "author once, target a set of buses, push" pipeline), simplified:
 * no budget/quota, no advertiser role, no audio stop-ads, no completed/rerun lifecycle — a
 * schedule is just always active and loops until you change it.
 */
export default function SchedulesPanel() {
  const [schedules, setSchedules] = useState([]);
  const [buses, setBuses] = useState([]);
  const emptyForm = {
    name: '',
    targetBusIds: [],
    items: [],
    showFullscreenAds: true,
    showBannerAds: true,
    activeDays: [],
    startDate: '',
    endDate: '',
  };
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  // One row per file in the most recent multi-select, in selection order — status is
  // 'pending' | 'uploading' | 'done' | 'error', shown next to the file input so an admin
  // dropping in a batch of files can see exactly which ones landed and which failed.
  const [uploadQueue, setUploadQueue] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editOpen, setEditOpen] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editUploading, setEditUploading] = useState(null);
  const [editUploadQueue, setEditUploadQueue] = useState({});

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

  // Uploads a batch of files one at a time (server takes one file per request; sequential also
  // keeps playlist `order` deterministic and matching selection order) while keeping
  // `uploadQueue` updated after every step so the status list reflects live progress instead of
  // jumping straight from "all pending" to "all done".
  async function uploadItems(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const queue = files.map((file) => ({ name: file.name, status: 'pending', error: null }));
    setUploadQueue(queue);
    setUploading(true);
    setMessage('');
    const newItems = [];
    const baseOrder = form.items.length;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validationError = validateAdMediaFile(file);
      if (validationError) {
        queue[i] = { ...queue[i], status: 'error', error: validationError };
        setUploadQueue([...queue]);
        continue;
      }
      queue[i] = { ...queue[i], status: 'uploading' };
      setUploadQueue([...queue]);
      try {
        const up = await uploadMedia(file, 'schedule');
        newItems.push({
          id: `item-${Date.now()}-${i}`,
          mediaFile: up.path,
          kind: adMediaTypeFromFile(file),
          order: baseOrder + newItems.length,
          durationSec: null,
        });
        queue[i] = { ...queue[i], status: 'done' };
      } catch (err) {
        queue[i] = { ...queue[i], status: 'error', error: err.message ?? 'Upload failed' };
      }
      setUploadQueue([...queue]);
    }
    if (newItems.length) setForm((f) => ({ ...f, items: [...f.items, ...newItems] }));
    setUploading(false);
    const failed = queue.filter((q) => q.status === 'error').length;
    setMessage(
      failed
        ? `Uploaded ${newItems.length}/${files.length} file(s) — ${failed} failed`
        : `Uploaded ${newItems.length} file(s)`
    );
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
    setForm(emptyForm);
    setUploadQueue([]);
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
    clearEditUploadQueue(s.id);
    setEditForm({
      ...editForm,
      [s.id]: {
        name: s.name,
        targetBusIds: [...(s.targetBusIds ?? [])],
        items: (s.items ?? []).map((i) => ({ ...i })),
        showFullscreenAds: s.showFullscreenAds !== false,
        showBannerAds: s.showBannerAds !== false,
        activeDays: [...(s.activeDays ?? [])],
        startDate: s.startDate ?? '',
        endDate: s.endDate ?? '',
      },
    });
  }

  function closeEdit() {
    setEditOpen(null);
  }

  function clearEditUploadQueue(id) {
    setEditUploadQueue((q) => {
      const { [id]: _removed, ...rest } = q;
      return rest;
    });
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

  // Edit-form counterpart to uploadItems() above — same sequential-with-live-status shape, keyed
  // by schedule id since multiple schedules' edit panels could in principle be open across
  // re-renders (editUploadQueue is a map, not a single list).
  async function uploadEditItems(id, fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const queue = files.map((file) => ({ name: file.name, status: 'pending', error: null }));
    setEditUploadQueue((q) => ({ ...q, [id]: queue }));
    setEditUploading(id);
    setMessage('');
    const newItems = [];
    const baseOrder = editForm[id].items.length;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const validationError = validateAdMediaFile(file);
      if (validationError) {
        queue[i] = { ...queue[i], status: 'error', error: validationError };
        setEditUploadQueue((q) => ({ ...q, [id]: [...queue] }));
        continue;
      }
      queue[i] = { ...queue[i], status: 'uploading' };
      setEditUploadQueue((q) => ({ ...q, [id]: [...queue] }));
      try {
        const up = await uploadMedia(file, 'schedule');
        newItems.push({
          id: `item-${Date.now()}-${i}`,
          mediaFile: up.path,
          kind: adMediaTypeFromFile(file),
          order: baseOrder + newItems.length,
          durationSec: null,
        });
        queue[i] = { ...queue[i], status: 'done' };
      } catch (err) {
        queue[i] = { ...queue[i], status: 'error', error: err.message ?? 'Upload failed' };
      }
      setEditUploadQueue((q) => ({ ...q, [id]: [...queue] }));
    }
    if (newItems.length) {
      const current = editForm[id];
      updateEditField(id, 'items', [...current.items, ...newItems]);
    }
    setEditUploading(null);
    const failed = queue.filter((q) => q.status === 'error').length;
    setMessage(
      failed
        ? `Uploaded ${newItems.length}/${files.length} file(s) — ${failed} failed`
        : `Uploaded ${newItems.length} file(s)`
    );
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
                  {b.profile?.mode === 'auto' && <span className="hint"> (auto — follows window)</span>}
                  {(!b.profile?.mode || b.profile.mode === 'route') && (
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
          <ScheduleWindowEditor window={form} onChange={(w) => setForm({ ...form, ...w })} />
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
              multiple
              disabled={uploading}
              onChange={(e) => {
                const files = e.target.files;
                e.target.value = '';
                if (files?.length) uploadItems(files);
              }}
            />
            <UploadStatusList queue={uploadQueue} />
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
              {(() => {
                const windowDesc = describeScheduleWindow(s);
                if (!windowDesc) return <span>always active</span>;
                const active = isScheduleWindowActive(s);
                return (
                  <span className={`version-pill ${active ? 'version-current' : 'version-unknown'}`}>
                    {windowDesc} {active ? '— active now' : '— not active now'}
                  </span>
                );
              })()}
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
                      {status.mode === 'entertainment'
                        ? ''
                        : status.mode === 'auto'
                          ? isScheduleWindowActive(s)
                            ? ' (auto — active now)'
                            : ' (auto — outside this schedule’s window, showing route)'
                          : ' (bus not in entertainment mode)'}
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
                <ScheduleWindowEditor
                  window={edit}
                  onChange={(w) => setEditForm({ ...editForm, [s.id]: { ...edit, ...w } })}
                />
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
                    multiple
                    disabled={editSlot}
                    onChange={(e) => {
                      const files = e.target.files;
                      e.target.value = '';
                      if (files?.length) uploadEditItems(s.id, files);
                    }}
                  />
                  <UploadStatusList queue={editUploadQueue[s.id] ?? []} />
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
