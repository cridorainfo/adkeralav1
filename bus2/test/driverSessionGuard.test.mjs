import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDriverSessionInfo,
  isDevicesDisconnectRevoked,
  loadDisconnectAck,
  saveDisconnectAck,
  clearDisconnectAck,
} from '../src/lib/driverSessionGuard.js';

test('isDevicesDisconnectRevoked is false without local ack', () => {
  clearDisconnectAck();
  assert.equal(isDevicesDisconnectRevoked('2026-01-01T00:00:00.000Z'), false);
});

test('isDevicesDisconnectRevoked detects admin bump after ack', () => {
  saveDisconnectAck('2026-01-01T00:00:00.000Z');
  assert.equal(isDevicesDisconnectRevoked('2026-01-01T00:00:00.000Z'), false);
  assert.equal(isDevicesDisconnectRevoked('2026-01-02T00:00:00.000Z'), true);
});

test('applyDriverSessionInfo saves ack when in sync', () => {
  clearDisconnectAck();
  const result = applyDriverSessionInfo({ devicesDisconnectAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(result.revoked, false);
  assert.equal(loadDisconnectAck(), '2026-01-01T00:00:00.000Z');
});

test('applyDriverSessionInfo does not revoke on stamp mismatch alone', () => {
  saveDisconnectAck('2026-01-01T00:00:00.000Z');
  const result = applyDriverSessionInfo({
    devicesDisconnectAt: '2026-01-02T00:00:00.000Z',
    unlocked: false,
  });
  assert.equal(result.revoked, false);
});
