import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCloudCommands } from '../server/cloudCommands.js';

test('SYNC_ASSIGNED_ROUTES replaces stop text authoritatively (no local merge)', () => {
  const current = {
    routesSavedAt: 9000,
    routes: [
      {
        id: 'r1',
        name: 'Route 1',
        sharedFromCloud: true,
        cloudRouteId: 'r1',
        startStop: { en: 'Origin', ml: 'പഴയ പേര്' },
        endStop: { en: 'Destination', ml: 'അവസാനം' },
        stops: [{ en: 'Mid Stop', ml: 'പഴയ നടുക്ക്' }],
      },
    ],
    busProfile: { assignedRouteIds: ['r1'] },
    stopCatalog: [{ en: 'Mid Stop', ml: 'പഴയ നടുക്ക്' }],
  };

  const merged = applyCloudCommands(current, [
    {
      type: 'SYNC_ASSIGNED_ROUTES',
      payload: {
        removeLocalOrphans: true,
        assignedRouteIds: ['r1'],
        savedAt: 5000,
        stopCatalog: [{ en: 'Mid Stop', ml: 'പുതിയ നടുക്ക്' }],
        routes: [
          {
            id: 'r1',
            name: 'Route 1',
            startStop: { en: 'Origin', ml: 'ആരംഭം' },
            endStop: { en: 'Destination', ml: 'അവസാനം' },
            stops: [{ en: 'Mid Stop', ml: 'പുതിയ നടുക്ക്' }],
          },
        ],
      },
    },
  ]);

  assert.equal(merged.routes[0].stops[0].ml, 'പുതിയ നടുക്ക്');
  assert.equal(merged.stopCatalog[0].ml, 'പുതിയ നടുക്ക്');
  assert.equal(merged.routesSavedAt, 9000);
});

function schedulePayload(items, extra = {}) {
  return {
    type: 'UPDATE_SCHEDULE',
    payload: {
      items,
      showFullscreenAds: true,
      showBannerAds: true,
      savedAt: 1000,
      scheduleSavedAt: 1000,
      ...extra,
    },
  };
}

test('UPDATE_SCHEDULE preserves currentIndex when the re-pushed list is the same length or longer', () => {
  const current = {
    schedule: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], currentIndex: 2, loopCount: 3 },
  };
  // Admin appended two more videos to the end of the existing list.
  const merged = applyCloudCommands(current, [
    schedulePayload([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]),
  ]);
  assert.equal(merged.schedule.currentIndex, 2, 'playback position must not reset just because the admin saved');
  assert.equal(merged.schedule.loopCount, 3, 'loopCount is not part of the UPDATE_SCHEDULE payload, must survive untouched');
});

test('UPDATE_SCHEDULE clamps currentIndex back to 0 when the re-pushed list is now shorter than it', () => {
  const current = {
    schedule: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], currentIndex: 3, loopCount: 1 },
  };
  // Admin removed items so the list is now shorter than where playback currently is.
  const merged = applyCloudCommands(current, [schedulePayload([{ id: 'a' }, { id: 'b' }])]);
  assert.equal(merged.schedule.currentIndex, 0, 'out-of-bounds index must clamp back to the start');
});

test('UPDATE_SCHEDULE keeps currentIndex in place when the re-pushed list is exactly the same length', () => {
  const current = {
    schedule: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], currentIndex: 1, loopCount: 0 },
  };
  const merged = applyCloudCommands(current, [
    // Same 3 items, e.g. admin only toggled showBannerAds off.
    schedulePayload([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { showBannerAds: false }),
  ]);
  assert.equal(merged.schedule.currentIndex, 1);
  assert.equal(merged.schedule.showBannerAds, false);
});
