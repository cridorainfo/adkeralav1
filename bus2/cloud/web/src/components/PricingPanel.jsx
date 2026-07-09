import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

function minutesToClock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function clockToMinutes(clock) {
  const [h, m] = String(clock ?? '00:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export default function PricingPanel() {
  const [ratePerSecond, setRatePerSecond] = useState(0);
  const [peakRatePerSecond, setPeakRatePerSecond] = useState(0);
  const [peakHours, setPeakHours] = useState([]);
  const [bannerRatePerSecond, setBannerRatePerSecond] = useState(0);
  const [audioRatePerSecond, setAudioRatePerSecond] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const json = await api('/api/pricing-settings');
      setRatePerSecond(json.ratePerSecond ?? 0);
      setPeakRatePerSecond(json.peakRatePerSecond ?? 0);
      setPeakHours(json.peakHours ?? []);
      setBannerRatePerSecond(json.bannerRatePerSecond ?? 0);
      setAudioRatePerSecond(json.audioRatePerSecond ?? 0);
    } catch (err) {
      setMessage(err.message ?? 'Could not load pricing settings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function addWindow() {
    setPeakHours([...peakHours, { startMin: 7 * 60, endMin: 9 * 60 }]);
  }

  function updateWindow(i, field, clockValue) {
    const next = [...peakHours];
    next[i] = { ...next[i], [field]: clockToMinutes(clockValue) };
    setPeakHours(next);
  }

  function removeWindow(i) {
    setPeakHours(peakHours.filter((_, idx) => idx !== i));
  }

  async function save() {
    setMessage('Saving…');
    try {
      const json = await api('/api/pricing-settings', {
        method: 'PUT',
        body: JSON.stringify({
          ratePerSecond,
          peakRatePerSecond,
          peakHours,
          bannerRatePerSecond,
          audioRatePerSecond,
        }),
      });
      setRatePerSecond(json.ratePerSecond ?? 0);
      setPeakRatePerSecond(json.peakRatePerSecond ?? 0);
      setPeakHours(json.peakHours ?? []);
      setBannerRatePerSecond(json.bannerRatePerSecond ?? 0);
      setAudioRatePerSecond(json.audioRatePerSecond ?? 0);
      setMessage('Saved');
    } catch (err) {
      setMessage(err.message ?? 'Could not save pricing settings');
    }
  }

  return (
    <div className="card">
      <h2>Ad pricing</h2>
      <p className="hint">
        Rate applies per second of ad watch-time, computed from reported plays — this is a
        platform-wide setting, not per bus. An ad stops appearing in rotation once its own
        budget (set per-ad in Campaigns) is spent at these rates; house ads fill the rest.
      </p>
      {loading && <p className="hint">Loading…</p>}

      <div className="inline-form">
        <div className="form-group">
          <label>Rate per second (₹)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={ratePerSecond}
            onChange={(e) => setRatePerSecond(Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Peak-hour rate per second (₹)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={peakRatePerSecond}
            onChange={(e) => setPeakRatePerSecond(Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Banner ad rate per second (₹)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={bannerRatePerSecond}
            onChange={(e) => setBannerRatePerSecond(Number(e.target.value))}
          />
        </div>
        <div className="form-group">
          <label>Audio stop-ad rate per second (₹)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={audioRatePerSecond}
            onChange={(e) => setAudioRatePerSecond(Number(e.target.value))}
          />
        </div>
      </div>
      <p className="hint">
        Banner and audio ads use a flat rate (no peak-hour split) — banner tracks how long it
        was shown before rotating away, audio tracks how long the stop-ad clip played.
      </p>

      <h3>Peak hours (Asia/Kolkata)</h3>
      <p className="hint">Windows where the peak rate applies instead — e.g. morning + evening rush.</p>
      {peakHours.map((w, i) => (
        <div key={i} className="inline-form">
          <div className="form-group">
            <label>Start</label>
            <input type="time" value={minutesToClock(w.startMin)} onChange={(e) => updateWindow(i, 'startMin', e.target.value)} />
          </div>
          <div className="form-group">
            <label>End</label>
            <input type="time" value={minutesToClock(w.endMin)} onChange={(e) => updateWindow(i, 'endMin', e.target.value)} />
          </div>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeWindow(i)}>
            Remove
          </button>
        </div>
      ))}
      <div className="editor-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={addWindow}>
          Add peak window
        </button>
      </div>

      <div className="editor-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={loading}>
          Save pricing
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}
