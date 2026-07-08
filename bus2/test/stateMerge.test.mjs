import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeIncomingState } from '../server/stateMerge.js';
import { mergeAdPlayQueues, mergeRemoteState } from '../src/store/busStore.js';

test('mergeAdPlayQueues unions by id instead of letting either side win wholesale', () => {
  const current = [{ id: 'a', adId: 'ad1' }, { id: 'b', adId: 'ad2' }];
  const incoming = [{ id: 'b', adId: 'ad2' }, { id: 'c', adId: 'ad3' }];
  const merged = mergeAdPlayQueues(current, incoming);
  assert.deepEqual(merged.map((p) => p.id).sort(), ['a', 'b', 'c']);
});

test('mergeAdPlayQueues caps at 500 entries', () => {
  const current = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}` }));
  const incoming = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}` }));
  assert.equal(mergeAdPlayQueues(current, incoming).length, 500);
});

test('mergeIncomingState never lets a newer-savedAt write wipe out unsent ad plays', () => {
  // A driver-phone GPS save (or any other write) that bumps savedAt must not clobber ad
  // plays the display queued locally but the bus hasn't uploaded to cloud yet.
  const current = {
    savedAt: 1000,
    pendingAdPlays: [{ id: 'play-1', adId: 'ad1', durationPlayedSec: 12, completed: true }],
  };
  const incoming = {
    savedAt: 2000,
    driverLocation: { lat: 10, lng: 76, at: 2000 },
    // Phone never ran the ad view, so its own copy is stale/empty.
    pendingAdPlays: [],
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.pendingAdPlays.length, 1);
  assert.equal(merged.pendingAdPlays[0].id, 'play-1');
});

test('mergeRemoteState never lets a newer remote savedAt wipe out local unsent ad plays', () => {
  const prev = {
    savedAt: 1000,
    pendingAdPlays: [{ id: 'play-1', adId: 'ad1', durationPlayedSec: 12, completed: true }],
  };
  const remote = { savedAt: 2000, pendingAdPlays: [] };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.pendingAdPlays.length, 1);
  assert.equal(merged.pendingAdPlays[0].id, 'play-1');
});

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

test('mergeIncomingState keeps forward stop index when driveRevision is newer', () => {
  const current = {
    savedAt: 5000,
    driveRevision: 4,
    currentStopIndex: 6,
    tripStarted: true,
    tripDeparted: true,
    tripEnded: false,
    routeDirection: 'forward',
  };
  const incoming = {
    savedAt: 5000,
    driveRevision: 3,
    currentStopIndex: 5,
    tripStarted: true,
    tripDeparted: true,
    tripEnded: false,
    routeDirection: 'forward',
    driverLocation: { lat: 8.82, lng: 76.95, at: 5000 },
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.currentStopIndex, 6);
  assert.equal(merged.driveRevision, 4);
  assert.equal(merged.driverLocation.lat, 8.82);
});

test('mergeIncomingState ignores client connectedDeviceCount overwrite', () => {
  const current = {
    savedAt: 5000,
    connectedDeviceCount: 2,
    driverLink: { driverId: 'phone-abc', linkedAt: 4000 },
    busProfile: { pairingCode: '4821' },
  };
  const incoming = {
    savedAt: 5001,
    connectedDeviceCount: 0,
    driverLink: null,
    driverLocation: { lat: 8.82, lng: 76.95, at: 5001 },
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.connectedDeviceCount, 2);
  assert.equal(merged.driverLink?.driverId, 'phone-abc');
  assert.equal(merged.busProfile.pairingCode, '4821');
});

test('mergeIncomingState keeps driverLink when phone GPS save omits it', () => {
  const current = {
    savedAt: 5000,
    driverLink: { driverId: 'phone-abc123', linkedAt: 4000 },
    busProfile: { pairingCode: '4821' },
  };
  const incoming = {
    savedAt: 5000,
    driverLink: null,
    driverLocation: { lat: 8.82, lng: 76.95, at: 5000 },
  };

  const merged = mergeIncomingState(current, incoming);
  assert.equal(merged.driverLink?.driverId, 'phone-abc123');
  assert.equal(merged.driverLocation.lat, 8.82);
});

test('mergeIncomingState keeps assignedRouteIds when phone save omits them', () => {
  const current = {
    savedAt: 5000,
    busProfile: {
      pairingCode: '4821',
      assignedRouteIds: ['route-a', 'route-b'],
    },
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
  };
  const incoming = {
    savedAt: 5001,
    busProfile: { pairingCode: '4821', assignedRouteIds: [] },
    driverLocation: { lat: 1, lng: 2, at: 5001 },
  };

  const merged = mergeIncomingState(current, incoming);
  assert.deepEqual(merged.busProfile.assignedRouteIds, ['route-a', 'route-b']);
});

test('mergeRemoteState keeps newer driveRevision over stale poll', () => {
  const prev = {
    savedAt: 7000,
    driveRevision: 8,
    currentStopIndex: 3,
    tripStarted: true,
    tripDeparted: true,
  };
  const remote = {
    savedAt: 7100,
    driveRevision: 7,
    currentStopIndex: 2,
    tripStarted: true,
    tripDeparted: true,
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.currentStopIndex, 3);
  assert.equal(merged.driveRevision, 8);
  assert.equal(merged.savedAt, 7100);
});

test('mergeRemoteState applies server trip reset at same driveRevision when savedAt is newer', () => {
  const prev = {
    savedAt: 7000,
    driveRevision: 4,
    currentStopIndex: 5,
    tripStarted: true,
    tripDeparted: true,
    tripEnded: false,
    activeRouteId: 'route-a',
  };
  const remote = {
    savedAt: 8000,
    driveRevision: 4,
    currentStopIndex: 0,
    tripStarted: false,
    tripDeparted: false,
    tripEnded: false,
    activeRouteId: 'route-a',
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.tripStarted, false);
  assert.equal(merged.currentStopIndex, 0);
  assert.equal(merged.tripDeparted, false);
});

test('mergeRemoteState keeps assigned routes when remote poll omits routes array', () => {
  const prev = {
    savedAt: 7000,
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
    busProfile: { assignedRouteIds: ['route-a'] },
  };
  const remote = {
    savedAt: 8000,
    routes: [],
    busProfile: { assignedRouteIds: ['route-a'] },
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.routes.length, 1);
  assert.equal(merged.routes[0].id, 'route-a');
});

test('mergeRemoteState keeps activeRouteId when remote poll clears it but routes remain', () => {
  const prev = {
    savedAt: 7000,
    activeRouteId: 'route-a',
    routes: [{ id: 'route-a', name: 'A', startStop: { en: 'X' }, endStop: { en: 'Y' }, stops: [] }],
    busProfile: { assignedRouteIds: ['route-a'] },
  };
  const remote = {
    savedAt: 8000,
    activeRouteId: null,
    routes: [],
    busProfile: { assignedRouteIds: ['route-a'] },
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.routes.length, 1);
  assert.equal(merged.activeRouteId, 'route-a');
});

test('mergeIncomingState strips stopVoiceAds from any client POST — cloud-managed only', () => {
  const current = {
    savedAt: 1000,
    stopVoiceAds: { 'main street': { audioFile: 'ad.mp3', enabled: true } },
  };
  const incoming = {
    savedAt: 2000,
    // A driver phone or PC control app POSTing /api/state with a stale/empty cached copy.
    stopVoiceAds: {},
  };

  const merged = mergeIncomingState(current, incoming);
  assert.deepEqual(merged.stopVoiceAds, { 'main street': { audioFile: 'ad.mp3', enabled: true } });
});

test('mergeRemoteState always prefers the server\'s stopVoiceAds over a stale local copy', () => {
  const prev = {
    savedAt: 2000,
    stopVoiceAds: { 'main street': { audioFile: 'old.mp3', enabled: true } },
  };
  const remote = {
    savedAt: 1000,
    stopVoiceAds: { 'main street': { audioFile: 'new.mp3', enabled: true } },
  };

  const merged = mergeRemoteState(prev, remote);
  assert.equal(merged.stopVoiceAds['main street'].audioFile, 'new.mp3');
});
