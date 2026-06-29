import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeIncomingState } from '../server/stateMerge.js';
import { mergeRemoteState } from '../src/store/busStore.js';

test('mergeIncomingState prefers newer cloud route names', () => {
  const current = {
    savedAt: 1000,
    lastCloudPushAt: 1000,
    routes: [{ id: 'r1', name: 'Old Route', startStop: { en: 'A' }, endStop: { en: 'B' }, stops: [] }],
    activeRouteId: 'r1',
  };
  const incoming = {
    savedAt: 2000,
    lastCloudPushAt: 2000,
    routes: [{ id: 'r1', name: 'New Route', startStop: { en: 'A' }, endStop: { en: 'B' }, stops: [] }],
    activeRouteId: 'r1',
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.routes[0].name, 'New Route');
  assert.equal(merged.lastCloudPushAt, 2000);
});

test('mergeRemoteState prefers newer remote savedAt for GPS', () => {
  const prev = {
    savedAt: 5000,
    driverLocation: { lat: 10.1, lng: 76.2, at: 9000 },
  };
  const remote = {
    savedAt: 8000,
    driverLocation: { lat: 10.0, lng: 76.1, at: 7000 },
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.driverLocation.at, 7000);
  assert.equal(merged.savedAt, 8000);
});

test('mergeIncomingState preserves ad playback on bus display during driver GPS save', () => {
  const current = {
    savedAt: 1000,
    displayView: 'ad',
    adStartedAt: 5000,
    lastAdEndedAt: 4000,
    currentAdIndex: 1,
  };
  const incoming = {
    savedAt: 1001,
    displayView: 'route',
    driverLocation: { lat: 10, lng: 76, at: 1001 },
    lastAdEndedAt: 4000,
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.displayView, 'ad');
  assert.equal(merged.currentAdIndex, 1);
});

test('mergeRemoteState clears driverLink when cloud push is newer even if savedAt is older', () => {
  const prev = {
    savedAt: 9000,
    lastCloudPushAt: 1000,
    driverLink: { driverId: 'phone-abc', linkedAt: 5000 },
    busProfile: { pairingCode: '1111' },
  };
  const remote = {
    savedAt: 8000,
    lastCloudPushAt: 9500,
    driverLink: null,
    busProfile: { pairingCode: '4829' },
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.driverLink, null);
  assert.equal(merged.busProfile.pairingCode, '4829');
  assert.equal(merged.lastCloudPushAt, 9500);
});
