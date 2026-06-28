import { useCallback, useEffect, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

const emptyAd = () => ({
  id: `ad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '',
  type: 'image',
  mediaFile: '',
  durationSec: 12,
});

const emptyBanner = () => ({
  id: `banner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: '',
  type: 'image',
  mediaFile: '',
  durationSec: 8,
});

export default function AdsPanel() {
  const { selectedBusId, targetBusIds } = useSelectedBus();
  const [ads, setAds] = useState([]);
  const [bannerAds, setBannerAds] = useState([]);
  const [catalogAt, setCatalogAt] = useState(0);
  const [source, setSource] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setAds([]);
      setBannerAds([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads/catalog`);
      setAds(json.ads?.length ? json.ads : []);
      setBannerAds(json.bannerAds?.length ? json.bannerAds : []);
      setCatalogAt(json.adsSavedAt ?? json.savedAt ?? 0);
      setSource(json.source ?? null);
    } catch (err) {
      setError(err.message ?? 'Could not load ads catalog');
    } finally {
      setLoading(false);
    }
  }, [selectedBusId]);

  useEffect(() => {
    loadCatalog();
    const t = setInterval(loadCatalog, 5000);
    return () => clearInterval(t);
  }, [loadCatalog]);

  async function persistCatalog({ push = false, nextAds = ads, nextBanners = bannerAds } = {}) {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      throw new Error('Select a claimed bus in the toolbar first.');
    }
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads/catalog`, {
      method: 'PUT',
      body: JSON.stringify({
        ads: nextAds,
        bannerAds: nextBanners,
        push,
      }),
    });
    setCatalogAt(json.catalog?.adsSavedAt ?? Date.now());
    setSource(json.catalog?.source ?? 'dashboard');
    return json;
  }

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
    setBusy(true);
    setError('');
    try {
      const category = isBanner ? 'banners' : 'ads';
      const up = await uploadMedia(file, category);
      const patch = {
        mediaFile: up.path ?? up.audioFile,
        type: file.type.startsWith('video') ? 'video' : 'image',
      };
      if (isBanner) {
        const next = [...bannerAds];
        next[i] = { ...next[i], ...patch };
        setBannerAds(next);
        await persistCatalog({ push: true, nextAds: ads, nextBanners: next });
      } else {
        const next = [...ads];
        next[i] = { ...next[i], ...patch };
        setAds(next);
        await persistCatalog({ push: true, nextAds: next, nextBanners: bannerAds });
      }
      setMessage('Saved & queued for bus');
    } catch (err) {
      setError(err.message ?? 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeAd(i, isBanner) {
    const nextAds = isBanner ? ads : ads.filter((_, j) => j !== i);
    const nextBanners = isBanner ? bannerAds.filter((_, j) => j !== i) : bannerAds;
    setAds(nextAds);
    setBannerAds(nextBanners);
    setBusy(true);
    setError('');
    try {
      await persistCatalog({ push: true, nextAds, nextBanners });
      setMessage('Deleted & synced to bus');
    } catch (err) {
      setError(err.message ?? 'Delete failed');
      await loadCatalog();
    } finally {
      setBusy(false);
    }
  }

  async function saveOnly() {
    setBusy(true);
    setError('');
    try {
      await persistCatalog({ push: false });
      setMessage('Saved to server catalog');
    } catch (err) {
      setError(err.message ?? 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function pushToBuses() {
    if (!targetBusIds.length) {
      setMessage('Enable push and select at least one bus');
      return;
    }
    setBusy(true);
    setError('');
    try {
      for (const busId of targetBusIds) {
        await api(`/api/buses/${encodeURIComponent(busId)}/ads/catalog`, {
          method: 'PUT',
          body: JSON.stringify({ ads, bannerAds, push: true }),
        });
      }
      setMessage(`Synced to ${targetBusIds.join(', ')}`);
      await loadCatalog();
    } catch (err) {
      setError(err.message ?? 'Push failed');
    } finally {
      setBusy(false);
    }
  }

  if (!selectedBusId || selectedBusId === 'bus-1') {
    return (
      <div className="card">
        <h2>Ads</h2>
        <p className="hint">Select a claimed bus in the toolbar to manage its ad catalog.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Ads — {selectedBusId}</h2>
      <p className="hint">
        Ads are saved on the server per bus and sync with the PC <code>db/info.txt</code>.
        Changes from the bus control panel appear here within ~5s. Deletes sync both ways.
      </p>
      {catalogAt > 0 && (
        <p className="hint">
          Catalog updated {new Date(catalogAt).toLocaleString()}
          {source ? ` · last change: ${source}` : ''}
        </p>
      )}

      <div className="editor-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={loadCatalog} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <h3>Fullscreen ads</h3>
      {ads.length === 0 && <p className="hint">No fullscreen ads yet.</p>}
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
            <input type="file" accept="image/*,video/*" disabled={busy} onChange={(e) => handleMediaUpload(i, e.target.files?.[0], false)} />
            {ad.mediaFile && <small>{ad.mediaFile}</small>}
          </div>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => removeAd(i, false)}>
            Delete
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setAds([...ads, emptyAd()])}>
        + Add fullscreen ad
      </button>

      <h3>Banner ads (728×90)</h3>
      {bannerAds.length === 0 && <p className="hint">No banner ads yet.</p>}
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
            <input type="file" accept="image/*" disabled={busy} onChange={(e) => handleMediaUpload(i, e.target.files?.[0], true)} />
            {ad.mediaFile && <small>{ad.mediaFile}</small>}
          </div>
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => removeAd(i, true)}>
            Delete
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setBannerAds([...bannerAds, emptyBanner()])}>
        + Add banner ad
      </button>

      <div className="editor-actions">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={saveOnly}>
          Save to server
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={pushToBuses}>
          Save & push ({targetBusIds.length || 0} bus{targetBusIds.length === 1 ? '' : 'es'})
        </button>
      </div>
      {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
