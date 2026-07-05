import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { isFleetRevoked } from '../server/fleetRevoke.js';
import { clearDeviceClaim, loadDeviceConfig } from '../server/deviceConfig.js';
import { resetBusStateForUnclaim } from '../server/fleetUnclaim.js';

test('isFleetRevoked only matches explicit bus-token rejection', () => {
  assert.equal(isFleetRevoked({ ok: true, status: 200, json: { ok: true } }), false);
  assert.equal(isFleetRevoked({ ok: false, status: 404, json: { error: 'Bus not found' } }), false);
  assert.equal(isFleetRevoked({ ok: false, status: 403, json: { error: 'Forbidden' } }), false);
  assert.equal(
    isFleetRevoked({ ok: false, status: 401, json: { error: 'Invalid bus token', revoked: true } }),
    true
  );
  assert.equal(
    isFleetRevoked({ ok: false, status: 401, json: { error: 'Invalid bus key' } }),
    false
  );
});

test('clearDeviceClaim keeps installId and fleetClaimCode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adkerala-device-'));
  try {
    const configPath = path.join(dir, 'adkerala.device.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        installId: '11111111-2222-4333-8444-555555555555',
        fleetClaimCode: '654321',
        busId: 'bus-abc',
        deviceToken: 'secret-token',
        claimedAt: 1,
      })
    );

    clearDeviceClaim(dir);
    const next = loadDeviceConfig(dir);
    assert.equal(next.busId, null);
    assert.equal(next.deviceToken, null);
    assert.equal(next.claimedAt, null);
    assert.equal(next.installId, '11111111-2222-4333-8444-555555555555');
    assert.equal(next.fleetClaimCode, '654321');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
