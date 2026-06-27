import { useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

const emptyAd = () => ({
  id: `ad-${Date.now()}`,
  name: '',
  type: 'image',
  mediaFile: '',
  durationSec: 12,
});

const emptyBanner = () => ({
  id: `banner-${Date.now()}`,
  name: '',
  type: 'image',
  mediaFile: '',
  durationSec: 8,
});

export default function AdsPanel() {
  const { selectedBusId } = useSelectedBus();
  const [ads, setAds] = useState([emptyAd()]);
  const [bannerAds, setBannerAds] = useState([emptyBanner()]);
  const [message, setMessage] = useState('');

  function updateAd(i, patch) {
    const next = [...ads];
    next[i] = { ...next[i], ...patch };
    setAds(next);
  }

  function updateBanner(i, patch) {
    const next = [...bannerAds];
    next[i] = { ...next[i], ...patch };
    setBannerAds(next);
  }

  async function handleMediaUpload(i, file, isBanner) {
    if (!file) return;
    const category = isBanner ? 'banners' : 'ads';
    const up = await uploadMedia(file, category);
    if (isBanner) updateBanner(i, { mediaFile: up.path, type: file.type.startsWith('video') ? 'video' : 'image' });
    else updateAd(i, { mediaFile: up.path, type: file.type.startsWith('video') ? 'video' : 'image' });
  }

  async function pushAds() {
    setMessage('Queuing…');
    await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        ads: ads.filter((a) => a.mediaFile),
        bannerAds: bannerAds.filter((a) => a.mediaFile),
      }),
    });
    setMessage(`Queued for ${selectedBusId}`);
  }

  return (
    <div className="card">
      <h2>Push ads to bus</h2>
      <p className="hint">Fullscreen 1920×1080 ads and 728×90 banner strip. Media uploads to cloud then queues for bus download.</p>

      <h3>Fullscreen ads</h3>
      {ads.map((ad, i) => (
        <div key={ad.id} className="inline-form" style={{ marginBottom: '0.5rem' }}>
          <div className="form-group">
            <label>Name</label>
            <input value={ad.name} onChange={(e) => updateAd(i, { name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Duration (sec)</label>
            <input type="number" value={ad.durationSec} onChange={(e) => updateAd(i, { durationSec: Number(e.target.value) })} />
          </div>
          <div className="form-group">
            <label>Media</label>
            <input type="file" accept="image/*,video/*" onChange={(e) => handleMediaUpload(i, e.target.files?.[0], false)} />
            {ad.mediaFile && <small>{ad.mediaFile}</small>}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAds([...ads, emptyAd()])}>
        + Add fullscreen ad
      </button>

      <h3>Banner ads (728×90)</h3>
      {bannerAds.map((ad, i) => (
        <div key={ad.id} className="inline-form" style={{ marginBottom: '0.5rem' }}>
          <div className="form-group">
            <label>Name</label>
            <input value={ad.name} onChange={(e) => updateBanner(i, { name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Duration (sec)</label>
            <input type="number" value={ad.durationSec} onChange={(e) => updateBanner(i, { durationSec: Number(e.target.value) })} />
          </div>
          <div className="form-group">
            <label>Media</label>
            <input type="file" accept="image/*" onChange={(e) => handleMediaUpload(i, e.target.files?.[0], true)} />
            {ad.mediaFile && <small>{ad.mediaFile}</small>}
          </div>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setBannerAds([...bannerAds, emptyBanner()])}>
        + Add banner ad
      </button>

      <div className="editor-actions">
        <button type="button" className="btn btn-primary" onClick={pushAds}>
          Queue for {selectedBusId}
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
