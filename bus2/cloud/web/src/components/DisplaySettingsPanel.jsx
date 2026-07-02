import { useState } from 'react';
import { fleetBroadcast } from '../lib/api.js';
import { useSelectedBus } from './BusContext.jsx';

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

export default function DisplaySettingsPanel() {
  const { targetBusIds, pushToBus } = useSelectedBus();
  const [form, setForm] = useState(defaultForm);
  const [message, setMessage] = useState('');

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
    setMessage('Queuing…');
    const patchPayload = { ...form };
    if (!patchPayload.displaySettings.brandTitle) {
      delete patchPayload.displaySettings.brandTitle;
    }
    const json = await fleetBroadcast({
      targetBusIds,
      commandType: 'MERGE_STATE',
      payload: patchPayload,
    });
    setMessage(`Queued for ${(json.queuedFor ?? []).join(', ')}`);
  }

  const t = form.displaySettings.theme;

  return (
    <div className="card">
      <h2>Display &amp; passenger screen settings</h2>
      <p className="hint">
        Push display timing, ad rotation, announcements, and theme colors to bus passenger screens.
      </p>

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
        <button type="button" className="btn btn-primary" onClick={pushSettings}>
          Push settings ({targetBusIds.length || 0} bus{targetBusIds.length === 1 ? '' : 'es'})
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
