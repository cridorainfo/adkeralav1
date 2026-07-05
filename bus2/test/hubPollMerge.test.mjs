import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeHubPollState } from '../cloud/shared/hub/mergeHubPollState.js';

test('mergeHubPollState keeps routes when hub poll omits routes array', () => {
  const prev = {
    savedAt: 7000,
    tripStarted: true,
    driveRevision: 3,
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
    activeRouteId: 'route-a',
    busProfile: { assignedRouteIds: ['route-a'] },
  };
  const incoming = {
    savedAt: 8000,
    tripStarted: true,
    driveRevision: 3,
    routes: [],
    activeRouteId: null,
    busProfile: { assignedRouteIds: ['route-a'] },
  };

  const merged = mergeHubPollState(prev, incoming);
  assert.equal(merged.routes.length, 1);
  assert.equal(merged.activeRouteId, 'route-a');
  assert.equal(merged.tripStarted, true);
});

test('mergeHubPollState applies newer trip revision from hub poll', () => {
  const prev = {
    savedAt: 7000,
    tripStarted: false,
    driveRevision: 2,
    currentStopIndex: 0,
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
    activeRouteId: 'route-a',
  };
  const incoming = {
    savedAt: 7100,
    tripStarted: true,
    tripDeparted: true,
    driveRevision: 3,
    currentStopIndex: 0,
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
    activeRouteId: 'route-a',
  };

  const merged = mergeHubPollState(prev, incoming);
  assert.equal(merged.tripStarted, true);
  assert.equal(merged.driveRevision, 3);
});
