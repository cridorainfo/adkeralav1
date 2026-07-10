import { useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { basename, pushAudioMergeToBuses } from '../lib/audioCatalogPush.js';
import { useSelectedBus } from './BusContext.jsx';

const PHRASES = ['attention', 'nextStop', 'pleaseAlight', 'terminus'];

export default function VoicesPanel() {
  const { pushToBus, targetBusIds } = useSelectedBus();
  const [fragments, setFragments] = useState({});
  const [message, setMessage] = useState('');
  const [busyPhrase, setBusyPhrase] = useState(null);

  async function load() {
    const json = await api('/api/announcements/phrases/catalog');
    setFragments(json.audioFragments ?? {});
  }

  useEffect(() => {
    load();
  }, []);

  async function persistPhrasePatch(phrase, patch, mediaFiles = []) {
    setBusyPhrase(phrase);
    setMessage('Saving…');
    try {
      const saved = await api('/api/announcements/phrases', {
        method: 'PUT',
        body: JSON.stringify({ audioFragments: patch, mediaFiles }),
      });
      setFragments(saved.audioFragments ?? {});
      if (pushToBus && targetBusIds.length) {
        await pushAudioMergeToBuses({
          targetBusIds,
          audioFragments: patch,
          mediaFiles,
          removedMediaFiles: saved.removedFiles ?? [],
        });
      }
      return saved;
    } finally {
      setBusyPhrase(null);
    }
  }

  async function uploadPhrase(phrase, file) {
    if (!file) return;
    setBusyPhrase(phrase);
    setMessage('Uploading…');
    try {
      const up = await uploadMedia(file, 'announcements');
      const patch = { [phrase]: { en: { audioFile: up.path } } };
      await persistPhrasePatch(phrase, patch, [up.path]);
      setMessage(`Replaced audio for ${phrase}`);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    } finally {
      setBusyPhrase(null);
    }
  }

  async function deletePhrase(phrase) {
    const current = fragments[phrase]?.en?.audioFile;
    if (!current) return;
    if (!confirm(`Remove audio for "${phrase}"?`)) return;
    const patch = { [phrase]: { en: { audioFile: null } } };
    const saved = await persistPhrasePatch(phrase, patch);
    setMessage(`Removed audio for ${phrase}`);
  }

  return (
    <div className="card">
      <h2>Voice announcements</h2>
      <p className="hint">
        Global phrase audio (attention, next stop, etc.). One file per phrase — uploading replaces the
        previous clip. Per-stop voices are in the route editor and stops hub.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Phrase</th>
            <th>Current file</th>
            <th>Replace</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {PHRASES.map((phrase) => {
            const file = fragments[phrase]?.en?.audioFile ?? null;
            const busy = busyPhrase === phrase;
            return (
              <tr key={phrase}>
                <td>{phrase}</td>
                <td>{busy ? 'Uploading…' : file ? basename(file) : '—'}</td>
                <td>
                  <input
                    type="file"
                    accept="audio/*,.mp3,.mpeg,.mpga,audio/mpeg"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) uploadPhrase(phrase, f);
                    }}
                  />
                </td>
                <td>
                  {file ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => deletePhrase(phrase)}
                    >
                      Delete
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
