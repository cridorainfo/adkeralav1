import { getAllStops, getStopEn } from '../store/busStore';
import { PHRASE_KEYS, stopAudioKey } from '../lib/audioFragments';
import VoiceRecorder from './VoiceRecorder';

function LangPair({ enLabel, mlLabel, enAudio, mlAudio, onSaveEn, onSaveMl, onClearEn, onClearMl }) {
  return (
    <div className="voice-lang-pair">
      <VoiceRecorder
        label={`EN — ${enLabel}`}
        audioUrl={enAudio}
        onSave={onSaveEn}
        onClear={onClearEn}
        compact
      />
      <VoiceRecorder
        label={`ML — ${mlLabel}`}
        audioUrl={mlAudio}
        onSave={onSaveMl}
        onClear={onClearMl}
        compact
      />
    </div>
  );
}

export default function AnnouncementManager({
  state,
  onUpdateFragment,
  onClearFragment,
  onUpdateStopAudio,
  onClearStopAudio,
  onToggleStopAd,
  onUpdateSettings,
  onTestAnnouncement,
}) {
  const activeRoute = (state.routes ?? []).find((r) => r.id === state.activeRouteId);
  const allStops = activeRoute ? getAllStops(activeRoute) : [];
  const fragments = state.audioFragments ?? {};
  const stopAudio = state.stopAudio ?? {};
  const settings = state.announcementSettings ?? {};

  return (
    <>
      <div className="panel">
        <h3 className="panel-title">🔊 Voice Announcements</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--kerala-muted)', marginBottom: '1rem' }}>
          Record common phrases once — they are shared for every bus and route. Only stop name clips
          change per place. Announcements play whatever is available; missing stop names are skipped.
        </p>

        <div className="form-row">
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={settings.enabled ?? true}
                onChange={(e) => onUpdateSettings({ enabled: e.target.checked })}
                style={{ marginRight: '0.5rem' }}
              />
              Enable voice announcements
            </label>
          </div>
          <div className="form-group">
            <label>
              <input
                type="checkbox"
                checked={settings.autoAnnounceOnForward ?? true}
                onChange={(e) => onUpdateSettings({ autoAnnounceOnForward: e.target.checked })}
                style={{ marginRight: '0.5rem' }}
              />
              Auto-announce when pressing Forward
            </label>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ maxWidth: 180 }}>
            <label>Pause between clips (ms)</label>
            <input
              type="number"
              min={0}
              max={2000}
              step={50}
              value={settings.pauseBetweenFragmentsMs ?? 300}
              onChange={(e) =>
                onUpdateSettings({ pauseBetweenFragmentsMs: Number(e.target.value) })
              }
            />
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">📼 Common Phrases</h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--kerala-muted)', marginBottom: '1rem' }}>
          Record each phrase in English and Malayalam. These are reused for every announcement.
        </p>
        <div className="voice-phrase-list">
          {PHRASE_KEYS.map(({ key, label, labelMl }) => (
            <div key={key} className="voice-phrase-row">
              <LangPair
                enLabel={label}
                mlLabel={labelMl}
                enAudio={fragments[key]?.en?.audioUrl}
                mlAudio={fragments[key]?.ml?.audioUrl}
                onSaveEn={(url) => onUpdateFragment(key, 'en', url)}
                onSaveMl={(url) => onUpdateFragment(key, 'ml', url)}
                onClearEn={() => onClearFragment(key, 'en')}
                onClearMl={() => onClearFragment(key, 'ml')}
              />
            </div>
          ))}
        </div>
      </div>

      {activeRoute && (
        <div className="panel">
          <h3 className="panel-title">🚏 Stop Name Audio — {activeRoute.name}</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--kerala-muted)', marginBottom: '1rem' }}>
            Record only the place name for each stop. Combined with phrases above to build sentences.
          </p>
          <ul className="voice-stop-list">
            {allStops.map((stop, i) => {
              const key = stopAudioKey(stop);
              const saved = stopAudio[key] ?? {};
              const isStart = i === 0;
              const isEnd = i === allStops.length - 1;

              return (
                <li key={`${key}-${i}`} className="voice-stop-row">
                  <div className="voice-stop-name">
                    {isStart && '🟢 '}
                    {isEnd && !isStart && '🔴 '}
                    {!isStart && !isEnd && '🟡 '}
                    {getStopEn(stop)}
                    {stop.ml && <small lang="ml"> · {stop.ml}</small>}
                  </div>
                  <LangPair
                    enLabel={getStopEn(stop)}
                    mlLabel={stop.ml || getStopEn(stop)}
                    enAudio={saved.en?.audioUrl}
                    mlAudio={saved.ml?.audioUrl}
                    onSaveEn={(url) => onUpdateStopAudio(key, 'en', url)}
                    onSaveMl={(url) => onUpdateStopAudio(key, 'ml', url)}
                    onClearEn={() => onClearStopAudio(key, 'en')}
                    onClearMl={() => onClearStopAudio(key, 'ml')}
                  />
                  <div className="voice-lang-pair voice-ad-slot">
                    <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(saved.adEnabled)}
                        onChange={(e) => onToggleStopAd(key, e.target.checked)}
                      />
                      Play ad after this announcement
                    </label>
                    <VoiceRecorder
                      label="Ad voice"
                      audioUrl={saved.ad?.audioUrl}
                      onSave={(url) => onUpdateStopAudio(key, 'ad', url)}
                      onClear={() => onClearStopAudio(key, 'ad')}
                      compact
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost voice-test-btn"
                    onClick={() => onTestAnnouncement(stop, isEnd)}
                  >
                    ▶ Preview
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!activeRoute && (
        <div className="panel">
          <p style={{ color: 'var(--kerala-muted)' }}>
            Select a route under Routes to record stop name audio clips.
          </p>
        </div>
      )}
    </>
  );
}
