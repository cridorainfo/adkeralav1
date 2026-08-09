import { useState } from 'react';
import { doubleConfirm } from '../lib/confirm.js';

/** Not routed through lib/api.js's api() helper — that always parses the response as JSON, which
 * doesn't work for a binary file download. Downloads and triggers a save via a throwaway <a>,
 * the standard way to turn a fetch() response into a "Save As" without navigating the page. */
async function downloadEncryptedBackup(passphrase) {
  const res = await fetch('/api/admin/backup/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? `adkerala-backup-${new Date().toISOString().slice(0, 10)}.abkp`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Full-platform backup/restore — see cloud/backup.js for exactly what's included (routes,
 * schedules, campaigns/ads, pricing, house ads, announcements, bus profiles + their per-bus
 * catalogs, login accounts) and what's deliberately excluded (bus device tokens, play
 * history/analytics, media file binaries). The download is encrypted end-to-end with an
 * admin-chosen passphrase that's never sent anywhere but this one request and never stored
 * server-side — see cloud/backupCrypto.js.
 */
export default function BackupPanel() {
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');

  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [restoreResult, setRestoreResult] = useState(null);

  async function handleExport(e) {
    e.preventDefault();
    setExportMessage('');
    if (exportPassphrase.length < 8) {
      setExportMessage('Passphrase must be at least 8 characters');
      return;
    }
    if (exportPassphrase !== exportConfirm) {
      setExportMessage('Passphrases do not match');
      return;
    }
    setExporting(true);
    try {
      await downloadEncryptedBackup(exportPassphrase);
      setExportMessage(
        'Backup downloaded — write the passphrase down somewhere safe. It is not saved anywhere and cannot be recovered; without it, this file can never be restored.'
      );
      setExportPassphrase('');
      setExportConfirm('');
    } catch (err) {
      setExportMessage(err.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleRestore(e) {
    e.preventDefault();
    setRestoreMessage('');
    setRestoreResult(null);
    if (!restoreFile) {
      setRestoreMessage('Choose a backup file first');
      return;
    }
    if (!restorePassphrase) {
      setRestoreMessage('Enter the passphrase this backup was downloaded with');
      return;
    }
    const ok = doubleConfirm(
      'Restoring overwrites routes, schedules, campaigns/ads, pricing, house ads, announcements, ' +
        'bus profiles, and login accounts with whatever is in this backup file — anything created ' +
        'since the backup was taken stays untouched but anything with the same id is replaced. ' +
        'This includes YOUR OWN login account: if this backup predates it, or your password has ' +
        'changed since, you may be signed out immediately and need to log back in with the ' +
        "credentials from when the backup was taken. Every bus will need to be re-claimed " +
        '(device tokens are not included in backups). Continue?',
      'This really does overwrite current data with the backup, including login accounts. Restore now?'
    );
    if (!ok) return;
    setRestoring(true);
    try {
      const fileBase64 = await fileToBase64(restoreFile);
      const res = await fetch('/api/admin/backup/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, passphrase: restorePassphrase }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error ?? `Restore failed (${res.status})`);
      setRestoreResult(json);
      setRestoreMessage(
        json.exportedAt
          ? `Restore complete — this backup was taken ${new Date(json.exportedAt).toLocaleString()}.`
          : 'Restore complete.'
      );
      setRestorePassphrase('');
      setRestoreFile(null);
    } catch (err) {
      setRestoreMessage(err.message ?? 'Restore failed');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="card">
      <h2>Backup &amp; restore</h2>
      <p className="hint">
        Downloads every route, schedule, campaign/ad, pricing setting, house ad, announcement, bus
        profile, and login account as one encrypted file — enough to fully repopulate a fresh
        deployment if this one is ever lost or corrupted. <strong>Not included:</strong> bus device
        tokens (each bus falls back to its normal "boot &amp; claim" 6-digit code flow after a
        restore, rather than a bulk secret export), ad play history/analytics, and the actual media
        files on the volume (this backs up the references to them, not the binary content).
      </p>

      <h3>Download backup</h3>
      <form onSubmit={handleExport} style={{ maxWidth: '28rem' }}>
        <div className="form-group">
          <label>Passphrase (min. 8 characters)</label>
          <input
            type="password"
            value={exportPassphrase}
            onChange={(e) => setExportPassphrase(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="form-group">
          <label>Confirm passphrase</label>
          <input
            type="password"
            value={exportConfirm}
            onChange={(e) => setExportConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <p className="hint">
          The whole file is encrypted with this passphrase (AES-256) — it's sent once for this
          request and never stored server-side, so it's on you to keep it safe. Lose it and the
          file can't be decrypted by anyone, including us.
        </p>
        <button type="submit" className="btn btn-primary btn-sm" disabled={exporting}>
          {exporting ? 'Preparing…' : 'Download backup'}
        </button>
      </form>
      {exportMessage && <p className="hint">{exportMessage}</p>}

      <h3 style={{ marginTop: '1.5rem' }}>Restore from backup</h3>
      <form onSubmit={handleRestore} style={{ maxWidth: '28rem' }}>
        <div className="form-group">
          <label>Backup file (.abkp)</label>
          <input type="file" accept=".abkp" onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="form-group">
          <label>Passphrase</label>
          <input
            type="password"
            value={restorePassphrase}
            onChange={(e) => setRestorePassphrase(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn btn-danger btn-sm" disabled={restoring}>
          {restoring ? 'Restoring…' : 'Restore'}
        </button>
      </form>
      {restoreMessage && <p className="hint">{restoreMessage}</p>}
      {restoreResult && (
        <>
          <div className="campaign-card-stats">
            {Object.entries(restoreResult.summary ?? {}).map(([key, count]) => (
              <span key={key}>
                {key}: {count}
              </span>
            ))}
            {restoreResult.errors?.length > 0 && (
              <span style={{ color: '#dc2626' }}>{restoreResult.errors.length} error(s) — see below</span>
            )}
          </div>
          {restoreResult.errors?.length > 0 && (
            <ul className="hint">
              {restoreResult.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
