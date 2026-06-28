import { useEffect, useState } from 'react';
import { api, uploadMedia, fleetBroadcast } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

const PHRASES = ['attention', 'nextStop', 'pleaseAlight', 'terminus'];

export default function VoicesPanel() {
  const { pushToBus, targetBusIds } = useSelectedBus();
  const [fragments, setFragments] = useState({});
  const [message, setMessage] = useState('');

  async function load() {
    const json = await api('/api/announcements/phrases/catalog');
    setFragments(json.audioFragments ?? {});
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadPhrase(phrase, file) {
    if (!file) return;
    setMessage('Uploading…');
    const up = await uploadMedia(file, 'announcements');
    const next = {
      ...fragments,
      [phrase]: {
        ...(fragments[phrase] ?? {}),
        en: { audioFile: up.path },
      },
    };
    await api('/api/announcements/phrases', {
      method: 'PUT',
      body: JSON.stringify({ audioFragments: next, mediaFiles: [up.path] }),
    });
    setFragments(next);
    setMessage(`Uploaded ${phrase}`);

    if (pushToBus && targetBusIds.length) {
      await fleetBroadcast({
        targetBusIds,
        commandType: 'MERGE_STATE',
        payload: {
          audioFragments: { [phrase]: next[phrase] },
          mediaFiles: [up.path],
        },
      });
    }
  }

  return (
    <div className="card">
      <h2>Voice announcements</h2>
      <p className="hint">Global phrase audio (attention, next stop, etc.) and per-stop voices in the route editor.</p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Phrase</th>
            <th>Current file</th>
            <th>Upload</th>
          </tr>
        </thead>
        <tbody>
          {PHRASES.map((phrase) => (
            <tr key={phrase}>
              <td>{phrase}</td>
              <td>{fragments[phrase]?.en?.audioFile ?? '—'}</td>
              <td>
                <input type="file" accept="audio/*,.mp3,.mpeg,.mpga,audio/mpeg" onChange={(e) => uploadPhrase(phrase, e.target.files?.[0])} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
