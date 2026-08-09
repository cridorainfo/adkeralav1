import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import FleetMap, { isBusOnline } from './FleetMap.jsx';
import FleetBusDetail from './FleetBusDetail.jsx';
import { busDisplayLabel, useSelectedBus } from './BusContext.jsx';
import { sortBusesAlphabetically, filterBusesBySearch } from '../lib/busSort.js';
import { downloadCsv } from '../lib/csvExport.js';
import AlertsSummaryPanel from './AlertsSummaryPanel.jsx';

const BUS_MODES = ['route', 'entertainment', 'auto'];
function normalizeBusMode(mode) {
  return BUS_MODES.includes(mode) ? mode : 'route';
}

function OnboardingWizard({ allowRegister, claimHref }) {
  const [pcDownload, setPcDownload] = useState(null);

  useEffect(() => {
    fetch('/api/releases/pc/latest')
      .then((r) => r.json())
      .then((json) => setPcDownload(json.release ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h2>Add a new bus</h2>
      <ol className="onboarding-steps" style={{ lineHeight: 1.7, paddingLeft: '1.25rem' }}>
        <li>
          <strong>Download PC app</strong> — install the AdKerala Display app on the bus computer.
          {pcDownload?.downloadUrl ? (
            <>
              {' '}
              <a href={pcDownload.downloadUrl} target="_blank" rel="noopener noreferrer">
                Download v{pcDownload.version}
              </a>
            </>
          ) : (
            <span className="hint"> (register a release in Releases tab first)</span>
          )}
        </li>
        <li>
          <strong>Boot &amp; claim</strong> — on first launch the display shows a <strong>6-digit fleet code</strong>.
          {allowRegister ? (
            <>
              {' '}
              Register bus ID below
              {claimHref ? (
                <>
                  , or <Link to={claimHref}>claim with fleet code</Link>
                </>
              ) : (
                ', or have the owner claim in the Owner portal'
              )}
              .
            </>
          ) : claimHref ? (
            <>
              {' '}
              Use <Link to={claimHref}>Claim bus</Link> with the code and plate.
            </>
          ) : null}
        </li>
        <li>
          <strong>Verify online</strong> — bus polls cloud every ~5s; it appears in the fleet list with a green dot when online.
        </li>
        <li>
          <strong>Pair driver</strong> — driver scans QR on the bus display and enters the{' '}
          <strong>4-digit pairing code</strong> you set below. Code stays the same until you
          disconnect all phones.
        </li>
        <li>
          <strong>Push content</strong> — use <strong>Ads</strong> tab with a bus selected to push ads to that bus only.
        </li>
      </ol>
    </div>
  );
}

export default function FleetPanel({ allowRegister = false, claimHref = null }) {
  const { selectedBusId, setSelectedBusId, refreshBuses } = useSelectedBus();
  const [buses, setBuses] = useState([]);
  const [profile, setProfile] = useState(null);
  const [plate, setPlate] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [mode, setMode] = useState('route');
  // Comma-separated in the input, array in the profile — depot/region/vehicle-type labels so an
  // admin can act on a cohort ("all Kochi depot buses") instead of one flat 1000-bus list. See
  // the feature-gap audit's finding on this.
  const [tagsInput, setTagsInput] = useState('');
  const [newBusId, setNewBusId] = useState('');
  const [newPlate, setNewPlate] = useState('');
  const [message, setMessage] = useState('');
  const [busSearch, setBusSearch] = useState('');

  const refresh = useCallback(async () => {
    const json = await api('/api/buses');
    setBuses(json.buses ?? []);
  }, []);

  const refreshSelected = useCallback(async () => {
    if (!selectedBusId) return;
    const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
    setProfile(json.profile);
  }, [selectedBusId]);

  /** Load editable fields only when switching buses — not on every poll. */
  useEffect(() => {
    if (!selectedBusId) {
      setProfile(null);
      setPlate('');
      setDisplayName('');
      setPairingCode('');
      setMode('route');
      setTagsInput('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
      if (cancelled) return;
      setProfile(json.profile);
      setPlate(json.profile?.plateDisplay || json.profile?.plate || '');
      setDisplayName(json.profile?.displayName ?? '');
      setPairingCode(json.profile?.pairingCode ?? '');
      setMode(normalizeBusMode(json.profile?.mode));
      setTagsInput((json.profile?.tags ?? []).join(', '));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBusId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    refreshSelected();
    const t = setInterval(refreshSelected, 4000);
    return () => clearInterval(t);
  }, [refreshSelected]);

  // Content mode is deliberately its own instant-apply action, separate from the "Save profile"
  // button below — admins flip Route/Auto/Entertainment often and in the moment (a charter
  // group boards early, a tour wraps late), so it can't wait on remembering to also click Save.
  // A mode-only PUT (server.js) both updates the profile and enqueues MERGE_STATE, which the bus
  // picks up on its next command poll — faster than waiting for the ~5s telemetry round-trip the
  // full profile save relies on — so this is the "seamless toggle" path.
  const [modeSwitching, setModeSwitching] = useState(false);
  async function switchMode(newMode) {
    if (!selectedBusId || newMode === mode) return;
    const prevMode = mode;
    setMode(newMode);
    setModeSwitching(true);
    setMessage('');
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ mode: newMode }),
      });
      setProfile(json.profile);
      setMode(normalizeBusMode(json.profile?.mode));
      setMessage(`Content mode set to "${newMode}" — takes effect on the bus within a few seconds`);
      refreshBuses();
    } catch (err) {
      setMode(prevMode);
      setMessage(err.message ?? 'Could not change content mode');
    } finally {
      setModeSwitching(false);
    }
  }

  async function saveProfile() {
    if (!selectedBusId) return;
    const code = pairingCode.replace(/\D/g, '').slice(0, 4);
    if (code && code.length !== 4) {
      setMessage('Pairing code must be exactly 4 digits');
      return;
    }
    setMessage('');
    const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ plate, displayName, pairingCode: code || undefined, mode, tags }),
      });
      setProfile(json.profile);
      setPlate(json.profile?.plateDisplay || json.profile?.plate || plate);
      setDisplayName(json.profile?.displayName ?? displayName);
      setPairingCode(json.profile?.pairingCode ?? code);
      setMode(normalizeBusMode(json.profile?.mode));
      setTagsInput((json.profile?.tags ?? tags).join(', '));
      setMessage('Bus profile saved');
      refreshBuses();
    } catch (err) {
      setMessage(err.message ?? 'Could not save bus profile');
    }
  }

  async function registerBus() {
    if (!newBusId.trim()) {
      setMessage('Enter a bus ID');
      return;
    }
    setMessage('');
    try {
      const json = await api('/api/buses/register', {
        method: 'POST',
        body: JSON.stringify({ busId: newBusId.trim(), plate: newPlate }),
      });
      setMessage(`Registered ${json.busId ?? newBusId}`);
      setNewBusId('');
      setNewPlate('');
      setSelectedBusId(json.busId ?? newBusId.trim());
      await refresh();
      refreshBuses();
    } catch (err) {
      setMessage(err.message ?? 'Register failed');
    }
  }

  async function disconnectAllPhones() {
    if (!selectedBusId) return;
    setMessage('');
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}/disconnect-all-phones`, {
        method: 'POST',
      });
      setMessage(
        'All driver phones disconnected — new pairing code shown below; share it with drivers'
      );
      refreshSelected();
      const json = await api(`/api/buses/${encodeURIComponent(selectedBusId)}/telemetry`);
      setProfile(json.profile);
      setPairingCode(json.profile?.pairingCode ?? '');
    } catch (err) {
      setMessage(err.message ?? 'Could not disconnect phones');
    }
  }

  async function disconnectDriver() {
    if (!selectedBusId) return;
    setMessage('');
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}/unlink-driver`, { method: 'POST' });
      setMessage('Driver disconnected — pairing QR will show on the bus display');
      refreshSelected();
    } catch (err) {
      setMessage(err.message ?? 'Could not disconnect driver');
    }
  }

  async function revokeDevice() {
    if (
      !selectedBusId ||
      !window.confirm(
        `Revoke device credentials for ${selectedBusId}? The bus PC will need to be re-claimed with a new fleet code afterward.`
      )
    ) {
      return;
    }
    setMessage('');
    try {
      await api(`/api/fleet/revoke/${encodeURIComponent(selectedBusId)}`, { method: 'POST' });
      setMessage('Device revoked — bus must be re-claimed');
      refreshSelected();
    } catch (err) {
      setMessage(err.message ?? 'Could not revoke device');
    }
  }

  async function deleteBus() {
    if (!selectedBusId) return;
    const label = displayName || plate || selectedBusId;
    if (
      !window.confirm(
        `Delete bus "${label}" (${selectedBusId})?\n\nThis removes the bus from the fleet. The PC must be re-claimed.`
      )
    ) {
      return;
    }
    setMessage('');
    try {
      await api(`/api/buses/${encodeURIComponent(selectedBusId)}`, { method: 'DELETE' });
      setMessage(`Deleted ${selectedBusId}`);
      setSelectedBusId('');
      await refresh();
      refreshBuses();
    } catch (err) {
      setMessage(err.message ?? 'Delete failed');
    }
  }

  // Alphabetical + searchable, not raw API order — same reasoning as Live Wall (LiveWallPanel.jsx):
  // the list otherwise reshuffles on every ~4s poll, and a 1000-bus fleet is unscannable without
  // either.
  const visibleBuses = useMemo(
    () => sortBusesAlphabetically(filterBusesBySearch(buses, busSearch)),
    [buses, busSearch]
  );

  return (
    <>
      <AlertsSummaryPanel />
      <OnboardingWizard allowRegister={allowRegister} claimHref={claimHref} />
      <div className="grid-2">
        <div className="card">
          <h2>Fleet</h2>
          <div className="form-group">
            <input
              type="search"
              value={busSearch}
              onChange={(e) => setBusSearch(e.target.value)}
              placeholder="Search by name, plate, or bus ID"
            />
          </div>
          <div className="campaigns-header">
            <p className="hint" style={{ marginBottom: 0 }}>
              {visibleBuses.length} bus{visibleBuses.length === 1 ? '' : 'es'}
              {busSearch.trim() ? ' matching' : ''}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                downloadCsv(
                  `adkerala-fleet-${new Date().toISOString().slice(0, 10)}.csv`,
                  visibleBuses.map((b) => ({
                    busId: b.busId,
                    name: b.profile?.displayName ?? '',
                    plate: b.profile?.plateDisplay || b.profile?.plate || '',
                    mode: b.profile?.mode ?? 'route',
                    tags: (b.profile?.tags ?? []).join('; '),
                    online: isBusOnline(b.updatedAt) ? 'online' : 'offline',
                    lastSeen: b.updatedAt ? new Date(b.updatedAt).toISOString() : '',
                  })),
                  [
                    { key: 'busId', label: 'Bus ID' },
                    { key: 'name', label: 'Name' },
                    { key: 'plate', label: 'Plate' },
                    { key: 'mode', label: 'Mode' },
                    { key: 'tags', label: 'Tags' },
                    { key: 'online', label: 'Online' },
                    { key: 'lastSeen', label: 'Last seen' },
                  ]
                )
              }
            >
              Export CSV
            </button>
          </div>
          {buses.length > 0 && !visibleBuses.length && (
            <p className="empty-state">No buses match “{busSearch.trim()}”.</p>
          )}
          {visibleBuses.map((bus) => (
            <div
              key={bus.busId}
              className={`bus-list-item ${bus.busId === selectedBusId ? 'selected' : ''}`}
              onClick={() => setSelectedBusId(bus.busId)}
              onKeyDown={(e) => e.key === 'Enter' && setSelectedBusId(bus.busId)}
              role="button"
              tabIndex={0}
            >
              <span>
                <span className={`status-dot ${isBusOnline(bus.updatedAt) ? 'online' : 'offline'}`} />
                {busDisplayLabel(bus)}
                {bus.profile?.mode === 'entertainment' && (
                  <span className="version-pill version-outdated" style={{ marginLeft: '0.5rem' }}>
                    entertainment
                  </span>
                )}
                {bus.profile?.mode === 'auto' && (
                  <span className="version-pill version-unknown" style={{ marginLeft: '0.5rem' }}>
                    auto
                  </span>
                )}
                {(bus.profile?.tags ?? []).map((tag) => (
                  <span key={tag} className="bus-pill" style={{ marginLeft: '0.35rem', fontSize: '0.7rem' }}>
                    {tag}
                  </span>
                ))}
              </span>
              <small>{bus.busId}</small>
            </div>
          ))}
          {!buses.length && <p className="hint">No buses yet. Register one below.</p>}

          {allowRegister && (
            <>
              <h3>Register bus (optional)</h3>
              <p className="hint">
                Pre-create a bus profile by ID. To link a real bus PC, use <strong>Claim bus</strong> with the 6-digit code from the display.
              </p>
              <div className="inline-form">
                <div className="form-group">
                  <label>Bus ID</label>
                  <input value={newBusId} onChange={(e) => setNewBusId(e.target.value)} placeholder="bus-1" />
                </div>
                <div className="form-group">
                  <label>Plate</label>
                  <input value={newPlate} onChange={(e) => setNewPlate(e.target.value)} placeholder="KL 07 AB 1234" />
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={registerBus}>
                  Add bus
                </button>
              </div>
            </>
          )}

          {selectedBusId && (
            <>
              <h3>Bus profile</h3>
              <p className="hint">Bus ID: <strong>{selectedBusId}</strong></p>
              <div className="form-group">
                <label>Friendly name</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. Route 42 — Trivandrum"
                />
              </div>
              <div className="form-group">
                <label>Number plate</label>
                <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="KL 07 AB 1234" />
              </div>
              <div className="form-group">
                <label>Tags</label>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="e.g. Kochi depot, AC coach"
                />
                <p className="hint">
                  Comma-separated — depot, region, vehicle type, whatever helps you find this bus
                  as part of a group. Also matched by every search box (Fleet, Live Wall, target-bus
                  pickers), not just this field.
                </p>
              </div>

              <h3>Content mode</h3>
              <p className="hint">
                Route buses show stops/announcements as normal. Entertainment buses (tourist
                charters etc.) show a looping media playlist instead — no stops/announcements —
                with ads/banners still playing on top. <strong>Auto</strong> follows whichever
                schedule is targeted at this bus: entertainment content only while that
                schedule's own day/date window is active (e.g. weekends-only), route view the
                rest of the time — no manual switching back and forth needed. Manage playlists
                and their windows in the <strong>Schedules</strong> tab.
              </p>
              <div className="form-group">
                <div className="campaign-filter-tabs">
                  {[
                    { key: 'route', label: 'Route (default)' },
                    { key: 'auto', label: 'Auto (follow schedule calendar)' },
                    { key: 'entertainment', label: 'Entertainment (always)' },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={modeSwitching}
                      className={`campaign-filter-tab${mode === opt.key ? ' active' : ''}`}
                      onClick={() => switchMode(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {modeSwitching && <small className="hint">Switching…</small>}
                <p className="hint">
                  Applies immediately — no need to click "Save profile" below for this.
                </p>
              </div>

              <h3>Driver access</h3>
              <p className="hint">
                Set a 4-digit pairing code and share it with drivers after they scan the bus QR.
                The code stays the same until you tap <strong>Disconnect all phones</strong>.
              </p>
              <div className="form-group">
                <label>Pairing code (4 digits)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="e.g. 4821"
                />
              </div>
              {profile?.linkedDriverId ? (
                <p className="hint">Cloud driver linked</p>
              ) : null}
              <div className="editor-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={saveProfile}>
                  Save profile
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={disconnectAllPhones}>
                  Disconnect all phones
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={disconnectDriver}>
                  Unlink cloud driver
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={revokeDevice}>
                  Revoke device
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={deleteBus}>
                  Delete bus
                </button>
              </div>
            </>
          )}
          {message && <p className="hint">{message}</p>}

          {selectedBusId && <FleetBusDetail busId={selectedBusId} buses={buses} />}
        </div>
        <div className="card">
          <h2>Live map</h2>
          <FleetMap buses={buses} selectedBusId={selectedBusId} onSelectBus={setSelectedBusId} />
        </div>
      </div>
    </>
  );
}
