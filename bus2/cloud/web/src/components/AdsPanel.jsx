import { useCallback, useEffect, useRef, useState } from 'react';
import { api, uploadMedia } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';
import AdMediaPreview from './AdMediaPreview.jsx';
import {
  AD_MEDIA_ACCEPT,
  AD_UPLOAD_HINTS,
  adMediaTypeFromFile,
  validateAdMediaFile,
} from '../lib/adMedia.js';

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
  const [dirty, setDirty] = useState(false);
  const [live, setLive] = useState(null);
  const [liveAds, setLiveAds] = useState(null);
  const dirtyRef = useRef(false);

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const clearDirty = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const loadCatalog = useCallback(async (force = false) => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setAds([]);
      setBannerAds([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads/catalog`);
      if (!dirtyRef.current || force) {
        setAds(json.ads?.length ? json.ads : []);
        setBannerAds(json.bannerAds?.length ? json.bannerAds : []);
        if (force) clearDirty();
      }
      setCatalogAt(json.adsSavedAt ?? json.savedAt ?? 0);
      setSource(json.source ?? null);
    } catch (err) {
      setError(err.message ?? 'Could not load ads catalog');
    } finally {
      setLoading(false);
    }
  }, [selectedBusId, clearDirty]);

  useEffect(() => {
    clearDirty();
    loadCatalog(true);
    const t = setInterval(() => loadCatalog(false), 5000);
    return () => clearInterval(t);
  }, [selectedBusId, loadCatalog, clearDirty]);

  const refreshLive = useCallback(async () => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setLive(null);
      return;
    }
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
      setLive(json);
    } catch {
      setLive(null);
    }
  }, [selectedBusId]);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, 5000);
    return () => clearInterval(t);
  }, [refreshLive]);

  const loadLiveAds = useCallback(async () => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setLiveAds(null);
      return;
    }
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads/live`);
      setLiveAds(json);
    } catch {
      setLiveAds(null);
    }
  }, [selectedBusId]);

  useEffect(() => {
    loadLiveAds();
    const t = setInterval(loadLiveAds, 5000);
    return () => clearInterval(t);
  }, [loadLiveAds]);

  const busState = live?.state ?? {};
  const onDisplay = Boolean(live?.online && busState.displayView === 'ad');
  const playingFullscreenIndex = onDisplay ? (busState.currentAdIndex ?? 0) : -1;
  const playingFullscreenAd = playingFullscreenIndex >= 0 ? ads[playingFullscreenIndex] : null;

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
    clearDirty();
    return json;
  }

  function updateAd(i, patch) {
    markDirty();
    const next = [...ads];
    next[i] = { ...next[i], ...patch };
    setAds(next);
  }

  function updateBanner(i, patch) {
    markDirty();
    const next = [...bannerAds];
    next[i] = { ...next[i], ...patch };
    setBannerAds(next);
  }

  function addAdRow(isBanner) {
    markDirty();
    if (isBanner) {
      setBannerAds((prev) => [...prev, emptyBanner()]);
    } else {
      setAds((prev) => [...prev, emptyAd()]);
    }
    setMessage('New ad slot added — upload media or save name, then push to bus.');
  }

  async function handleMediaUpload(i, file, isBanner) {
    if (!file) return;
    const validationError = validateAdMediaFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    setMessage(`Uploading ${file.name}…`);
    try {
      const category = isBanner ? 'banners' : 'ads';
      const list = isBanner ? bannerAds : ads;
      const oldMediaFile = list[i]?.mediaFile ?? '';
      const up = await uploadMedia(file, category);
      const patch = {
        mediaFile: up.path ?? up.audioFile,
        type: adMediaTypeFromFile(file),
      };
      let nextAds = ads;
      let nextBanners = bannerAds;
      if (isBanner) {
        nextBanners = [...bannerAds];
        nextBanners[i] = { ...nextBanners[i], ...patch };
        setBannerAds(nextBanners);
      } else {
        nextAds = [...ads];
        nextAds[i] = { ...nextAds[i], ...patch };
        setAds(nextAds);
      }
      await persistCatalog({ push: true, nextAds, nextBanners });
      if (oldMediaFile && oldMediaFile !== patch.mediaFile) {
        setMessage('Replaced media — old file removed from server');
      } else {
        setMessage('Saved & queued for bus');
      }
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
      await loadCatalog(true);
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
      await loadCatalog(true);
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
        Add as many ads as you need, upload media for each, then save &amp; push. Replacing a file
        removes the old one automatically.
      </p>
      {dirty && (
        <p className="hint" style={{ color: '#b45309' }}>
          Unsaved edits — use Save or Save &amp; push before leaving this page.
        </p>
      )}
      {catalogAt > 0 && (
        <p className="hint">
          Catalog updated {new Date(catalogAt).toLocaleString()}
          {source ? ` · last change: ${source}` : ''}
        </p>
      )}

      <section className="ads-live-preview">
        <h3>Now on passenger display</h3>
        {!live?.online && (
          <p className="hint">Bus offline — live preview unavailable.</p>
        )}
        {live?.online && !onDisplay && (
          <p className="hint">Route view is showing — no fullscreen ad playing right now.</p>
        )}
        {live?.online && onDisplay && playingFullscreenAd?.mediaFile && (
          <>
            <AdMediaPreview ad={playingFullscreenAd} format="fullscreen" playing showControls />
            <p className="hint" style={{ marginTop: '0.5rem' }}>
              {playingFullscreenAd.name?.trim() || `Ad ${playingFullscreenIndex + 1}`} ·{' '}
              {playingFullscreenAd.type === 'video' ? 'Video' : 'Image'} ·{' '}
              {playingFullscreenAd.durationSec ?? 12}s
            </p>
          </>
        )}
        {live?.online && onDisplay && !playingFullscreenAd?.mediaFile && (
          <p className="hint">An ad slot is active on the bus but has no media file.</p>
        )}
      </section>

      <section className="ads-live-preview">
        <h3>All ads on this bus (house + campaign)</h3>
        <p className="hint">
          Read-only — shows exactly what the bus itself sees, including house ads filling in
          once a campaign ad runs out of budget. Edit campaign ads below; house ads are managed
          on the House Ads page.
        </p>
        {!liveAds && <p className="hint">Loading…</p>}
        {liveAds && !liveAds.ads?.length && !liveAds.bannerAds?.length && (
          <p className="hint">No ads configured for this bus yet.</p>
        )}
        {liveAds?.ads?.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {liveAds.ads.map((ad) => (
                <tr key={ad.id}>
                  <td>{ad.name?.trim() || ad.id}</td>
                  <td>Fullscreen</td>
                  <td>{ad.isHouseAd ? 'House' : ad.campaignId ? 'Campaign' : 'Direct'}</td>
                  <td>
                    {ad.isHouseAd ? (
                      <span className="hint">always on</span>
                    ) : ad.exhausted ? (
                      <span className="version-pill version-below">budget exhausted</span>
                    ) : Number.isFinite(Number(ad.amount)) && Number(ad.amount) > 0 ? (
                      <span className="version-pill version-current">active</span>
                    ) : (
                      <span className="hint">unbudgeted</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="editor-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => loadCatalog(true)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <h3>Fullscreen ads ({ads.length})</h3>
      <p className="hint">{AD_UPLOAD_HINTS.fullscreen}</p>
      {ads.length === 0 && <p className="hint">No fullscreen ads yet — click Add below.</p>}
      {ads.map((ad, i) => (
        <div key={ad.id} className="ads-catalog-row">
          <AdMediaPreview
            ad={ad}
            format="fullscreen"
            playing={onDisplay && i === playingFullscreenIndex}
          />
          <div className="inline-form ads-catalog-fields">
            <div className="form-group">
              <label>Name</label>
              <input value={ad.name} onChange={(e) => updateAd(i, { name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Duration (sec)</label>
              <input
                type="number"
                value={ad.durationSec}
                onChange={(e) => updateAd(i, { durationSec: Number(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>Media</label>
              <input
                type="file"
                accept={AD_MEDIA_ACCEPT}
                disabled={busy}
                onChange={(e) => {
                  handleMediaUpload(i, e.target.files?.[0], false);
                  e.target.value = '';
                }}
              />
              {ad.mediaFile ? (
                <small>
                  {ad.type === 'video' ? 'Video' : 'Image'}: {ad.mediaFile.split('/').pop()}
                </small>
              ) : (
                <small className="hint">No file yet</small>
              )}
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => removeAd(i, false)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => addAdRow(false)}
      >
        + Add fullscreen ad
      </button>

      <h3>Banner ads ({bannerAds.length})</h3>
      <p className="hint">{AD_UPLOAD_HINTS.banner}</p>
      {bannerAds.length === 0 && <p className="hint">No banner ads yet — click Add below.</p>}
      {bannerAds.map((ad, i) => (
        <div key={ad.id} className="ads-catalog-row ads-catalog-row--banner">
          <AdMediaPreview ad={ad} format="banner" />
          <div className="inline-form ads-catalog-fields">
            <div className="form-group">
              <label>Name</label>
              <input value={ad.name} onChange={(e) => updateBanner(i, { name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Duration (sec)</label>
              <input
                type="number"
                value={ad.durationSec}
                onChange={(e) => updateBanner(i, { durationSec: Number(e.target.value) })}
              />
            </div>
            <div className="form-group">
              <label>Media</label>
              <input
                type="file"
                accept={AD_MEDIA_ACCEPT}
                disabled={busy}
                onChange={(e) => {
                  handleMediaUpload(i, e.target.files?.[0], true);
                  e.target.value = '';
                }}
              />
              {ad.mediaFile ? (
                <small>
                  {ad.type === 'video' ? 'Video' : 'Image'}: {ad.mediaFile.split('/').pop()}
                </small>
              ) : (
                <small className="hint">No file yet</small>
              )}
            </div>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => removeAd(i, true)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => addAdRow(true)}
      >
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
