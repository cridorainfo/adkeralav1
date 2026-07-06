import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearHubSetup,
  saveDisconnectAck,
  loadDisconnectAck,
  saveHubSession,
} from '../cloud/shared/hub/persist.js';

// Mirror client.js revoke check — ack must not be updated before comparing.
function isRevoked(devicesDisconnectAt) {
  if (!devicesDisconnectAt) return false;
  const ack = loadDisconnectAck();
  if (!ack) return false;
  return String(devicesDisconnectAt) !== String(ack);
}

function handleDisconnectStamp(devicesDisconnectAt) {
  if (isRevoked(devicesDisconnectAt)) {
    return { revoked: true };
  }
  if (devicesDisconnectAt) saveDisconnectAck(devicesDisconnectAt);
  return { revoked: false };
}

test('admin disconnect is detected before ack is overwritten', () => {
  clearHubSetup();
  saveHubSession({ token: 'tok', plate: 'KL01', origin: 'http://192.168.1.50:5174' });
  saveDisconnectAck('2026-01-01T00:00:00.000Z');

  const result = handleDisconnectStamp('2026-07-06T12:00:00.000Z');
  assert.equal(result.revoked, true);
  assert.equal(loadDisconnectAck(), '2026-01-01T00:00:00.000Z');
});

test('matching disconnect stamp updates ack without revoke', () => {
  clearHubSetup();
  saveDisconnectAck('2026-01-01T00:00:00.000Z');

  const result = handleDisconnectStamp('2026-01-01T00:00:00.000Z');
  assert.equal(result.revoked, false);
  assert.equal(loadDisconnectAck(), '2026-01-01T00:00:00.000Z');
});
