import { useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { AD_MEDIA_ACCEPT, adMediaTypeFromFile, validateAdMediaFile } from '../lib/adMedia.js';
import AdMediaPreview from './AdMediaPreview.jsx';

function AdList({ ads, format, onRemove }) {
  if (!ads.length) return <p className="empty-state">None yet.</p>;
  return ads.map((ad) => (
    <div key={ad.id} className="campaign-card">
      <AdMediaPreview ad={ad} format={format} />
      <strong>{ad.name || ad.id}</strong> <span className="hint">{ad.type} · {ad.durationSec}s</span>
      <div className="editor-actions">
        <button type="button" className="btn btn-danger btn-sm" onClick={() => onRemove(ad.id)}>
          Remove
        </button>
      </div>
    </div>
  ));
}

export default function HouseAdsPanel() {
  const [ads, setAds] = useState([]);
  const [bannerAds, setBannerAds] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const json = await api('/api/house-ads');
      setAds(json.ads ?? []);
      setBannerAds(json.bannerAds ?? []);
    } catch (err) {
      setMessage(err.message ?? 'Could not load house ads');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function uploadAd(file, isBanner) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    try {
      const up = await uploadMedia(file, isBanner ? 'banners' : 'ads');
      const item = {
        id: `house-${isBanner ? 'banner-' : ''}${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: adMediaTypeFromFile(file),
        mediaFile: up.path,
        durationSec: isBanner ? 8 : 12,
      };
      if (isBanner) setBannerAds([...bannerAds, item]);
      else setAds([...ads, item]);
    } catch (err) {
      setMessage(err.message ?? 'Upload failed');
    }
  }

  function removeAd(id) {
    setAds(ads.filter((a) => a.id !== id));
  }

  function removeBannerAd(id) {
    setBannerAds(bannerAds.filter((a) => a.id !== id));
  }

  async function save() {
    setMessage('Saving…');
    try {
      const json = await api('/api/house-ads', {
        method: 'PUT',
        body: JSON.stringify({ ads, bannerAds }),
      });
      setAds(json.ads ?? []);
      setBannerAds(json.bannerAds ?? []);
      setMessage('Saved — every bus picks this up on its next sync (~5s while online).');
    } catch (err) {
      setMessage(err.message ?? 'Could not save house ads');
    }
  }

  return (
    <div className="card">
      <h2>House / free ads</h2>
      <p className="hint">
        These play alongside paid campaign ads on every bus — fullscreen house ads become the
        only thing playing once a bus's paid fullscreen ads have all spent their budget (see
        Pricing); banner house ads just run alongside whatever banner ads are already targeted.
        No per-bus targeting, no budget, they never run out.
      </p>
      {loading && <p className="hint">Loading…</p>}

      <h3>Fullscreen house ads</h3>
      <AdList ads={ads} format="fullscreen" onRemove={removeAd} />
      <div className="form-group">
        <label>Add a fullscreen house ad (image or video)</label>
        <input type="file" accept={AD_MEDIA_ACCEPT} onChange={(e) => uploadAd(e.target.files?.[0], false)} />
      </div>

      <h3>Banner house ads</h3>
      <AdList ads={bannerAds} format="banner" onRemove={removeBannerAd} />
      <div className="form-group">
        <label>Add a banner house ad (image or video)</label>
        <input type="file" accept={AD_MEDIA_ACCEPT} onChange={(e) => uploadAd(e.target.files?.[0], true)} />
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
