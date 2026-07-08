import { useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { AD_MEDIA_ACCEPT, adMediaTypeFromFile, validateAdMediaFile } from '../lib/adMedia.js';

export default function HouseAdsPanel() {
  const [ads, setAds] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const json = await api('/api/house-ads');
      setAds(json.ads ?? []);
    } catch (err) {
      setMessage(err.message ?? 'Could not load house ads');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadAd(file) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    try {
      const up = await uploadMedia(file, 'ads');
      const item = {
        id: `house-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: adMediaTypeFromFile(file),
        mediaFile: up.path,
        durationSec: 12,
      };
      setAds([...ads, item]);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    }
  }

  function removeAd(id) {
    setAds(ads.filter((a) => a.id !== id));
  }

  async function save() {
    setMessage('Saving…');
    try {
      const json = await api('/api/house-ads', { method: 'PUT', body: JSON.stringify({ ads }) });
      setAds(json.ads ?? []);
      setMessage('Saved — every bus picks this up on its next sync (~5s while online).');
    } catch (err) {
      setMessage(err.message ?? 'Could not save house ads');
    }
  }

  return (
    <div className="card">
      <h2>House / free ads</h2>
      <p className="hint">
        These play alongside paid campaign ads on every bus, and become the only thing playing
        once a bus's paid ads have all spent their budget (see Pricing) — no per-bus targeting,
        no budget, they never run out.
      </p>
      {loading && <p className="hint">Loading…</p>}

      {ads.map((ad) => (
        <div key={ad.id} className="campaign-card">
          <strong>{ad.name || ad.id}</strong> <span className="hint">{ad.type} · {ad.durationSec}s</span>
          <div className="editor-actions">
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeAd(ad.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {!ads.length && !loading && <p className="empty-state">No house ads yet.</p>}

      <div className="form-group">
        <label>Add a house ad (image or video)</label>
        <input type="file" accept={AD_MEDIA_ACCEPT} onChange={(e) => uploadAd(e.target.files?.[0])} />
      </div>

      <div className="editor-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={loading}>
          Save house ads
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
