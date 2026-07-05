import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverJoinUrl, readPairingCodeFromLocation } from '../src/lib/driverJoinUrl.js';
import {
  normalizeControlUrl,
  readBusControlFromLocation,
} from '../src/lib/driverLanStorage.js';

test('buildDriverJoinUrl encodes control URL only (no pairing code)', () => {
  const join = buildDriverJoinUrl('http://192.168.1.50:5174/control?code=4821');
  assert.ok(join);
  const url = new URL(join);
  assert.equal(url.pathname, '/driver');
  assert.equal(url.searchParams.get('control'), 'http://192.168.1.50:5174/control');
  assert.equal(url.searchParams.get('code'), null);
});

test('normalizeControlUrl strips query params', () => {
  assert.equal(
    normalizeControlUrl('http://192.168.1.50:5174/control?code=4821'),
    'http://192.168.1.50:5174/control',
  );
});

test('readBusControlFromLocation reads control query param', () => {
  const raw = readBusControlFromLocation('?control=http%3A%2F%2F192.168.1.50%3A5174%2Fcontrol');
  assert.equal(raw, 'http://192.168.1.50:5174/control');
});

test('readPairingCodeFromLocation reads legacy code param', () => {
  assert.equal(readPairingCodeFromLocation('?code=4821'), '4821');
});
