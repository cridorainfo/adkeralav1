import test from 'node:test';
import assert from 'node:assert/strict';
import { resetBusStateForUnclaim } from '../server/fleetUnclaim.js';

test('resetBusStateForUnclaim clears fleet routes and ads', () => {
  const current = {
    routes: [{ id: 'r1', name: 'Route 1', startStop: { en: 'A' }, endStop: { en: 'B' }, stops: [] }],
    activeRouteId: 'r1',
    tripStarted: true,
    ads: [{ id: 'ad1', mediaUrl: 'ads/x.jpg' }],
    bannerAds: [{ id: 'b1', mediaUrl: 'banners/y.jpg' }],
    driverLink: { driverId: 'd1', linkedAt: 1 },
    busProfile: {
      plate: 'KL01AB1234',
      plateDisplay: 'KL 01 AB 1234',
      pairingCode: '1234',
      assignedRouteIds: ['r1'],
    },
    displaySettings: { brandTitle: 'Test Bus' },
  };

  const reset = resetBusStateForUnclaim(current);
  assert.deepEqual(reset.routes, []);
  assert.equal(reset.activeRouteId, null);
  assert.equal(reset.tripStarted, false);
  assert.deepEqual(reset.ads, []);
  assert.deepEqual(reset.bannerAds, []);
  assert.equal(reset.driverLink, null);
  assert.equal(reset.busProfile.plate, '');
  assert.match(reset.busProfile.pairingCode, /^\d{4}$/);
  assert.equal(reset.displaySettings.brandTitle, 'Test Bus');
});
