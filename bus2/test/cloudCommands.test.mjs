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
