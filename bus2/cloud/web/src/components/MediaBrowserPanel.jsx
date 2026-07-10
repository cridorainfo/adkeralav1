import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { doubleConfirm } from '../lib/confirm.js';
import { busDisplayLabel } from './BusContext.jsx';

const CATEGORY_LABELS = {
  ads: 'Ad media (fullscreen)',
  banners: 'Banner media',
  stops: 'Stop announcement audio',
  announcements: 'Global phrase audio',
};

function formatReference(ref, buses) {
  switch (ref.type) {
    case 'campaign':
      return `Campaign "${ref.label}"`;
    case 'house-ad':
      return 'House ad';
    case 'bus-catalog': {
      const bus = buses.find((b) => b.busId === ref.busId);
      return `Bus: ${busDisplayLabel(bus ?? { busId: ref.busId })}`;
    }
    case 'stop-voice-ad':
      return `Stop voice-ad: ${ref.stopKey}`;
    case 'stop-audio':
      return `Stop announcement: ${ref.stopKey} (${ref.lang})`;
    case 'phrase':
      return `Phrase: ${ref.phraseKey} (${ref.lang})`;
    default:
      return 'In use';
  }
}

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Manual counterpart to the automatic reference-checked purge that already runs on campaign,
 * house-ad, and catalog edits (see purgeUnreferencedMedia in server.js) — that keeps the volume
 * clean going forward, this page is for the backlog that built up before, or for an admin
 * manually removing a specific file. Deleting a file that's still referenced is allowed (an
 * admin override), but shown loudly before the double-confirm since it'll break whatever still
 * points at it.
 */
export default function MediaBrowserPanel() {
  const [data, setData] = useState(null);
  const [buses, setBuses] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('ads');
  const [onlyOrphaned, setOnlyOrphaned] = useState(false);
  const [deletingPath, setDeletingPath] = useState(null);

  async function load() {
    setError('');
    try {
      const [browse, busesJson] = await Promise.all([
        api('/api/media/browse'),
        api('/api/buses').catch(() => ({ buses: [] })),
      ]);
      setData(browse);
      setBuses(busesJson.buses ?? []);
    } catch (err) {
      setError(err.message ?? 'Could not load media list');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function removeFile(file) {
    const referencedBy = file.referencedBy ?? [];
    const refLines = referencedBy.map((ref) => formatReference(ref, buses)).join(', ');
    const firstMessage = referencedBy.length
      ? `"${file.filename}" is still in use (${refLines}). Deleting it also removes it from there, and every bus will drop its own local copy on its next sync (~5s). Delete anyway?`
      : `Delete "${file.filename}"? It isn't referenced anywhere and this removes it from the Railway volume permanently.`;
    const ok = doubleConfirm(
      firstMessage,
      referencedBy.length
        ? 'This file is still in active use elsewhere. Really delete it?'
        : 'This cannot be undone. Delete it anyway?'
    );
    if (!ok) return;
    setDeletingPath(file.path);
    setMessage('');
    setError('');
    try {
      await api(`/api/media/${file.path}`, { method: 'DELETE' });
      setMessage(`Deleted ${file.filename}`);
      load();
    } catch (err) {
      setError(err.message ?? 'Delete failed');
    } finally {
      setDeletingPath(null);
    }
  }

  const categories = data?.categories ?? {};
  const files = (categories[category] ?? []).filter((f) => !onlyOrphaned || !f.referencedBy.length);
  const summary = data?.summary;

  return (
    <div className="card">
      <h2>Media Browser</h2>
      <p className="hint">
        Every file on the media volume, across ads, banners, and audio. Files still in use are
        cleaned up automatically as soon as the ad, banner, or announcement referencing them is
        edited or removed elsewhere — use this page to find anything left over, or to manually
        remove a specific file.
      </p>

      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p className="hint">{message}</p>}

      {summary && (
        <p className="hint">
          {summary.totalFiles} file(s), {formatSize(summary.totalBytes)} total —{' '}
          {summary.orphanedFiles} orphaned ({formatSize(summary.orphanedBytes)}) not referenced
          anywhere.
        </p>
      )}

      <div className="campaign-filter-tabs">
        {Object.keys(CATEGORY_LABELS).map((key) => (
          <button
            key={key}
            type="button"
            className={`campaign-filter-tab${category === key ? ' active' : ''}`}
            onClick={() => setCategory(key)}
          >
            {CATEGORY_LABELS[key]}{' '}
            <span className="campaign-filter-count">{categories[key]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <label style={{ fontSize: '0.85rem', display: 'block', margin: '0.5rem 0' }}>
        <input
          type="checkbox"
          checked={onlyOrphaned}
          onChange={(e) => setOnlyOrphaned(e.target.checked)}
        />{' '}
        Only show orphaned (unreferenced) files
      </label>

      {!data && !error && <p className="hint">Loading…</p>}
      {data && !files.length && <p className="empty-state">No files here.</p>}

      {files.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Modified</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const referencedBy = file.referencedBy ?? [];
              return (
                <tr key={file.path}>
                  <td>{file.filename}</td>
                  <td>{formatSize(file.size)}</td>
                  <td>{file.mtime ? new Date(file.mtime).toLocaleString() : '—'}</td>
                  <td>
                    {referencedBy.length ? (
                      <span className="version-pill version-current">
                        in use — {referencedBy.map((r) => formatReference(r, buses)).join(', ')}
                      </span>
                    ) : (
                      <span className="version-pill version-below">orphaned</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={deletingPath === file.path}
                      onClick={() => removeFile(file)}
                    >
                      {deletingPath === file.path ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
