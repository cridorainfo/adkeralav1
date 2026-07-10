import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useSelectedBus, busDisplayLabel } from './BusContext.jsx';
import AdMediaPreview from './AdMediaPreview.jsx';

/**
 * Read-only by design — ads are only ever created via House Ads (unconditional, every bus)
 * or Campaigns (targeted, budgeted). Letting admins drop one-off ads directly onto a single
 * bus here used to bypass both budget tracking and campaign targeting entirely, and made it
 * unclear where any given ad on a bus actually came from. This page just answers "what's
 * playing on this bus right now, and which campaign or house ad put it there."
 */
export default function AdsPanel() {
  const { selectedBusId, buses } = useSelectedBus();
  const [campaigns, setCampaigns] = useState([]);
  const [live, setLive] = useState(null);
  const [liveAds, setLiveAds] = useState(null);
  const [error, setError] = useState('');

  const selectedBusLabel = busDisplayLabel(
    buses.find((b) => b.busId === selectedBusId) ?? { busId: selectedBusId }
  );

  const loadCampaigns = useCallback(async () => {
    try {
      const json = await api('/api/campaigns');
      setCampaigns(json.campaigns ?? []);
    } catch {
      setCampaigns([]);
    }
  }, []);

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

  const loadLiveAds = useCallback(async () => {
    if (!selectedBusId || selectedBusId === 'bus-1') {
      setLiveAds(null);
      return;
    }
    setError('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/ads/live`);
      setLiveAds(json);
    } catch (err) {
      setLiveAds(null);
      setError(err.message ?? 'Could not load ads for this bus');
    }
  }, [selectedBusId]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    refreshLive();
    const t = setInterval(refreshLive, 5000);
    return () => clearInterval(t);
  }, [refreshLive]);

  useEffect(() => {
    loadLiveAds();
    const t = setInterval(loadLiveAds, 5000);
    return () => clearInterval(t);
  }, [loadLiveAds]);

  const busState = live?.state ?? {};
  const onDisplay = Boolean(live?.online && busState.displayView === 'ad');
  const playingFullscreenIndex = onDisplay ? (busState.currentAdIndex ?? 0) : -1;
  const playingFullscreenAd =
    playingFullscreenIndex >= 0 ? liveAds?.ads?.[playingFullscreenIndex] : null;

  function sourceLabel(ad) {
    if (ad.isHouseAd) return 'House ad';
    if (ad.campaignId) {
      const campaign = campaigns.find((c) => c.id === ad.campaignId);
      return campaign ? campaign.name : 'Campaign (deleted)';
    }
    return '—';
  }

  function statusLabel(ad) {
    if (ad.isHouseAd) return <span className="hint">always on</span>;
    if (ad.exhausted) return <span className="version-pill version-below">budget exhausted</span>;
    if (Number.isFinite(Number(ad.amount)) && Number(ad.amount) > 0) {
      return <span className="version-pill version-current">active</span>;
    }
    return <span className="hint">unbudgeted</span>;
  }

  if (!selectedBusId || selectedBusId === 'bus-1') {
    return (
      <div className="card">
        <h2>Ads</h2>
        <p className="hint">Select a claimed bus in the toolbar to see its ads.</p>
      </div>
    );
  }

  const allAds = [
    ...(liveAds?.ads ?? []).map((ad) => ({ ...ad, format: 'Fullscreen' })),
    ...(liveAds?.bannerAds ?? []).map((ad) => ({ ...ad, format: 'Banner' })),
  ];

  return (
    <div className="card">
      <h2>Ads — {selectedBusLabel}</h2>
      <p className="hint">
        Read-only — ads only ever reach a bus via <strong>House ads</strong> (unconditional,
        every bus) or <strong>Campaigns</strong> (targeted + budgeted, pushed to buses). To add,
        change, or remove an ad, edit it on one of those pages — this page just shows what's
        currently on this bus and where it came from.
      </p>

      <section className="ads-live-preview">
        <h3>Now on passenger display</h3>
        {!live?.online && <p className="hint">Bus offline — live preview unavailable.</p>}
        {live?.online && !onDisplay && (
          <p className="hint">Route view is showing — no fullscreen ad playing right now.</p>
        )}
        {live?.online && onDisplay && playingFullscreenAd?.mediaFile && (
          <>
            <AdMediaPreview ad={playingFullscreenAd} format="fullscreen" playing showControls />
            <p className="hint" style={{ marginTop: '0.5rem' }}>
              {playingFullscreenAd.name?.trim() || `Ad ${playingFullscreenIndex + 1}`} ·{' '}
              {playingFullscreenAd.type === 'video' ? 'Video' : 'Image'} ·{' '}
              {playingFullscreenAd.durationSec ?? 12}s · {sourceLabel(playingFullscreenAd)}
            </p>
          </>
        )}
        {live?.online && onDisplay && !playingFullscreenAd?.mediaFile && (
          <p className="hint">An ad slot is active on the bus but has no media file.</p>
        )}
      </section>

      <section className="ads-live-preview">
        <h3>All ads on this bus ({allAds.length})</h3>
        {error && <p className="hint" style={{ color: '#dc2626' }}>{error}</p>}
        {!liveAds && !error && <p className="hint">Loading…</p>}
        {liveAds && !allAds.length && (
          <p className="empty-state">
            No ads configured for this bus yet — add one via House ads or Campaigns.
          </p>
        )}
        {allAds.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>Name</th>
                <th>Type</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {allAds.map((ad) => (
                <tr key={ad.id}>
                  <td className="ads-table-thumb">
                    <AdMediaPreview ad={ad} format={ad.format === 'Banner' ? 'banner' : 'fullscreen'} />
                  </td>
                  <td>{ad.name?.trim() || ad.id}</td>
                  <td>{ad.format}</td>
                  <td>{sourceLabel(ad)}</td>
                  <td>{statusLabel(ad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
