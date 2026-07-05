import { useCallback, useEffect, useState } from 'react';
import { api, fleetBroadcast } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';
import { isBusOnline } from './FleetMap.jsx';

const defaultForm = () => ({
  displaySettings: {
    languageAlternateSec: 4,
    brandTitle: '',
    theme: {
      primaryColor: '#1a5632',
      backgroundColor: '#0b1220',
      fontScale: 1,
      showClock: true,
      showBanner: true,
    },
  },
  adSettings: {
    enabled: true,
    initialDelaySec: 90,
    intervalSec: 90,
    defaultDurationSec: 12,
    playAudio: true,
  },
  bannerAdSettings: {
    enabled: true,
    defaultDurationSec: 8,
  },
  announcementSettings: {
    enabled: true,
    autoAnnounceOnForward: true,
    languages: ['ml', 'en'],
    pauseBetweenFragmentsMs: 300,
  },
});

function mergeLoadedSettings(catalog = {}) {
  const base = defaultForm();
  if (catalog.displaySettings) {
    base.displaySettings = {
      ...base.displaySettings,
      ...catalog.displaySettings,
      theme: {
        ...base.displaySettings.theme,
        ...(catalog.displaySettings.theme ?? {}),
      },
    };
  }
  if (catalog.adSettings) base.adSettings = { ...base.adSettings, ...catalog.adSettings };
  if (catalog.bannerAdSettings) {
    base.bannerAdSettings = { ...base.bannerAdSettings, ...catalog.bannerAdSettings };
  }
  if (catalog.announcementSettings) {
    base.announcementSettings = { ...base.announcementSettings, ...catalog.announcementSettings };
  }
  return base;
}

export default function DisplaySettingsPanel() {
  const { selectedBusId, targetBusIds, pushToBus, buses } = useSelectedBus();
  const [form, setForm] = useState(defaultForm);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCatalog = useCallback(async () => {
    if (!selectedBusId) {
      setForm(defaultForm());
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/display-settings/catalog`);
      setForm(mergeLoadedSettings(json));
    } catch (err) {
      setMessage(err.message ?? 'Could not load saved settings');
    } finally {
      setLoading(false);
    }
  }, [selectedBusId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  function patch(path, value) {
    setForm((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let cur = next;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys[keys.length - 1]] = value;
      return next;
    });
  }

  async function pushSettings() {
    if (!pushToBus || !targetBusIds.length) {
      setMessage('Enable push and select at least one bus');
      return;
    }
    setBusy(true);
    setMessage('Saving & pushing…');
    try {
      const patchPayload = { ...form };
      if (!patchPayload.displaySettings.brandTitle) {
        delete patchPayload.displaySettings.brandTitle;
      }
      const json = await fleetBroadcast({
        targetBusIds,
        commandType: 'MERGE_STATE',
        payload: patchPayload,
      });
      const onlineNow = json.onlineNow ?? [];
      const queuedFor = json.queuedFor ?? [];
      if (onlineNow.length === queuedFor.length && queuedFor.length) {
        setMessage(`Saved — delivering now to ${onlineNow.join(', ')} (within ~5s)`);
      } else if (onlineNow.length) {
        setMessage(
          `Saved — ${onlineNow.join(', ')} online (delivering now); ${queuedFor.filter((id) => !onlineNow.includes(id)).join(', ') || 'others'} queued until online`
        );
      } else {
        setMessage(`Saved — queued for ${queuedFor.join(', ')}. Applies on next bus sync when online.`);
      }
    } catch (err) {
      setMessage(err.message ?? 'Could not save settings');
    } finally {
      setBusy(false);
    }
  }

  const t = form.displaySettings.theme;
  const selectedOnline = buses.find((b) => b.busId === selectedBusId && isBusOnline(b.updatedAt));

  return (
    <div className="card">
      <h2>Display &amp; passenger screen settings</h2>
      <p className="hint">
        Push display timing, ad rotation, announcements, and theme colors to bus passenger screens.
        Settings are saved on the server; online buses receive them on the next sync (~5s).
      </p>
      {selectedBusId && (
        <p className="hint">
          Selected bus {selectedBusId}
          {selectedOnline ? ' is online — push delivers immediately.' : ' is offline — push queues until it reconnects.'}
        </p>
      )}

      {loading && <p className="hint">Loading saved settings…</p>}

      <h3>Display</h3>
      <div className="inline-form">
        <div className="form-group">
          <label>Language alternate (sec)</label>
          <input
            type="number"
            value={form.displaySettings.languageAlternateSec}
            onChange={(e) => patch('displaySettings.languageAlternateSec', Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Brand title override</label>
          <input
            value={form.displaySettings.brandTitle}
            onChange={(e) => patch('displaySettings.brandTitle', e.target.value)}
            placeholder="Optional — leave empty for default"
          />
        </div>
      </div>

      <h3>Theme</h3>
      <div className="inline-form">
        <div className="form-group">
          <label>Primary color</label>
          <input type="color" value={t.primaryColor} onChange={(e) => patch('displaySettings.theme.primaryColor', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Background</label>
          <input type="color" value={t.backgroundColor} onChange={(e) => patch('displaySettings.theme.backgroundColor', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Font scale</label>
          <input
            type="number"
            step="0.1"
            min="0.5"
            max="2"
            value={t.fontScale}
            onChange={(e) => patch('displaySettings.theme.fontScale', Number(e.target.value))}
          />
        </div>
        <label>
          <input type="checkbox" checked={t.showClock} onChange={(e) => patch('displaySettings.theme.showClock', e.target.checked)} /> Show clock
        </label>
        <label>
          <input type="checkbox" checked={t.showBanner} onChange={(e) => patch('displaySettings.theme.showBanner', e.target.checked)} /> Show banner strip
        </label>
      </div>

      <h3>Fullscreen ads</h3>
      <p className="hint">
        Initial delay runs after the passenger display opens; repeat interval is the gap between later ads.
      </p>
      <div className="inline-form">
        <label>
          <input type="checkbox" checked={form.adSettings.enabled} onChange={(e) => patch('adSettings.enabled', e.target.checked)} /> Enabled
        </label>
        <div className="form-group">
          <label>Initial delay (sec)</label>
          <input
            type="number"
            min="0"
            value={form.adSettings.initialDelaySec}
            onChange={(e) => patch('adSettings.initialDelaySec', Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Repeat interval (sec)</label>
          <input
            type="number"
            min="0"
            value={form.adSettings.intervalSec}
            onChange={(e) => patch('adSettings.intervalSec', Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Default duration (sec)</label>
          <input
            type="number"
            value={form.adSettings.defaultDurationSec}
            onChange={(e) => patch('adSettings.defaultDurationSec', Number(e.target.value))}
          />
        </div>
        <label>
          <input type="checkbox" checked={form.adSettings.playAudio} onChange={(e) => patch('adSettings.playAudio', e.target.checked)} /> Play ad audio
        </label>
      </div>

      <h3>Banner ads</h3>
      <div className="inline-form">
        <label>
          <input
            type="checkbox"
            checked={form.bannerAdSettings.enabled}
            onChange={(e) => patch('bannerAdSettings.enabled', e.target.checked)}
          />{' '}
          Enabled
        </label>
        <div className="form-group">
          <label>Duration (sec)</label>
          <input
            type="number"
            value={form.bannerAdSettings.defaultDurationSec}
            onChange={(e) => patch('bannerAdSettings.defaultDurationSec', Number(e.target.value))}
          />
        </div>
      </div>

      <h3>Announcements</h3>
      <div className="inline-form">
        <label>
          <input
            type="checkbox"
            checked={form.announcementSettings.enabled}
            onChange={(e) => patch('announcementSettings.enabled', e.target.checked)}
          />{' '}
          Enabled
        </label>
        <label>
          <input
            type="checkbox"
            checked={form.announcementSettings.autoAnnounceOnForward}
            onChange={(e) => patch('announcementSettings.autoAnnounceOnForward', e.target.checked)}
          />{' '}
          Auto on forward
        </label>
        <div className="form-group">
          <label>Pause between fragments (ms)</label>
          <input
            type="number"
            value={form.announcementSettings.pauseBetweenFragmentsMs}
            onChange={(e) => patch('announcementSettings.pauseBetweenFragmentsMs', Number(e.target.value))}
          />
        </div>
      </div>

      <div className="editor-actions">
        <button type="button" className="btn btn-primary" onClick={pushSettings} disabled={busy || loading}>
          Push settings ({targetBusIds.length || 0} bus{targetBusIds.length === 1 ? '' : 'es'})
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
