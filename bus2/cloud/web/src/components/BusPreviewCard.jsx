import AdMediaPreview from './AdMediaPreview.jsx';
import { busDisplayLabel } from './BusContext.jsx';
import { isBusOnline } from './FleetMap.jsx';

function EyeIcon({ active }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" fill={active ? 'currentColor' : 'none'} />
    </svg>
  );
}

export default function BusPreviewCard({ bus, selected, onSelectAnalytics }) {
  const online = Boolean(bus.online ?? isBusOnline(bus.updatedAt));
  const preview = bus.preview ?? {};
  const view = preview.displayView ?? 'route';
  const ad = preview.ad;
  const plate = bus.profile?.plateDisplay || bus.profile?.plate || '';
  const name = busDisplayLabel(bus);

  return (
    <article className={`live-wall-card${selected ? ' live-wall-card--selected' : ''}${online ? '' : ' live-wall-card--offline'}`}>
      <header className="live-wall-card-header">
        <div>
          <div className="live-wall-card-title">
            <span className={`status-dot ${online ? 'online' : 'offline'}`} />
            {name}
          </div>
          {plate ? <div className="live-wall-card-plate">{plate}</div> : null}
          <div className="hint" style={{ marginBottom: 0 }}>
            {bus.busId}
            {bus.updatedAt
              ? ` · ${online ? 'updated' : 'last seen'} ${new Date(bus.updatedAt).toLocaleTimeString()}`
              : ''}
          </div>
        </div>
      </header>

      <div className="live-wall-card-preview">
        {!online && (
          <div className="live-wall-preview-empty">
            Offline
            {bus.updatedAt ? (
              <span>Last seen {new Date(bus.updatedAt).toLocaleString()}</span>
            ) : (
              <span>No telemetry yet</span>
            )}
          </div>
        )}
        {online && view === 'ad' && ad?.mediaFile && (
          <>
            <AdMediaPreview ad={ad} format="fullscreen" playing className="live-wall-ad-thumb" />
            <div className="live-wall-preview-meta">
              <strong>{ad.name?.trim() || 'Advertisement'}</strong>
              <span>
                {ad.type === 'video' ? 'Video' : 'Image'}
                {ad.durationSec ? ` · ${ad.durationSec}s` : ''}
                {ad.isHouseAd ? ' · House ad' : ''}
              </span>
            </div>
          </>
        )}
        {online && view === 'ad' && !ad?.mediaFile && (
          <div className="live-wall-preview-empty">
            Advertisement
            <span>Ad slot active — media unavailable</span>
          </div>
        )}
        {online && view !== 'ad' && (
          <div className="live-wall-preview-route">
            <div className="live-wall-preview-badge">Route view</div>
            <h3>{preview.routeName || '—'}</h3>
            <div>
              Current: <strong>{preview.currentStopEn || '—'}</strong>
            </div>
            <div className="hint" style={{ marginBottom: 0 }}>
              Next: <strong>{preview.nextStopEn || '—'}</strong>
            </div>
          </div>
        )}
      </div>

      <footer className="live-wall-card-footer">
        <button
          type="button"
          className={`btn btn-sm ${selected ? 'btn-primary' : 'btn-secondary'} live-wall-eye-btn`}
          onClick={() => onSelectAnalytics(bus.busId)}
          title={selected ? 'Hide analytics' : 'Show ad analytics'}
          aria-label={selected ? 'Hide analytics' : 'Show ad analytics'}
          aria-pressed={selected}
        >
          <EyeIcon active={selected} />
          <span>{selected ? 'Hide stats' : 'Stats'}</span>
        </button>
      </footer>
    </article>
  );
}
