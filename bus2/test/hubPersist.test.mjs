import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDisconnectAck,
  saveDisconnectAck,
  clearHubSetup,
  normalizeControlUrl,
} from '../cloud/shared/hub/persist.js';

test('normalizeControlUrl forces /control path', () => {
  assert.equal(
    normalizeControlUrl('http://192.168.1.5:5174/driver'),
    'http://192.168.1.5:5174/control'
  );
});

test('disconnect ack tracks admin revoke stamp', () => {
  clearHubSetup();
  assert.equal(loadDisconnectAck(), null);
  saveDisconnectAck('2026-01-01T00:00:00.000Z');
  assert.equal(loadDisconnectAck(), '2026-01-01T00:00:00.000Z');
});
