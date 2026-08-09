import { useState } from 'react';
import { filterBusesBySearch } from '../lib/busSort.js';
import { busDisplayLabel } from './BusContext.jsx';

/** Searchable target-bus checkbox grid — shared by CampaignsPanel and SchedulesPanel's create/
 * edit forms (4 call sites). Used to be a flat unsearchable checkbox list at every one of those
 * sites, unusable once a fleet gets into the hundreds of buses — see the feature-gap audit's
 * finding on this. `buses` is expected pre-sorted (see lib/busSort.js's sortBusesAlphabetically,
 * already applied where these buses lists are loaded). */
export default function TargetBusPicker({ buses, selectedIds, onToggle, renderExtra }) {
  const [search, setSearch] = useState('');
  const visible = filterBusesBySearch(buses, search);

  return (
    <div>
      {buses.length > 8 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search buses to target"
          style={{ marginBottom: '0.4rem', maxWidth: '18rem' }}
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {visible.map((b) => (
          <label key={b.busId} style={{ fontSize: '0.85rem' }}>
            <input type="checkbox" checked={selectedIds.includes(b.busId)} onChange={() => onToggle(b.busId)} />{' '}
            {busDisplayLabel(b)}
            {renderExtra?.(b)}
          </label>
        ))}
        {!visible.length && <span className="hint">No buses match your search.</span>}
      </div>
    </div>
  );
}
