import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverJoinUrl, readPairingCodeFromLocation } from '../src/lib/driverJoinUrl.js';
import {
  normalizeControlUrl,
  readBusControlFromLocation,
} from '../src/lib/driverLanStorage.js';

test('buildDriverJoinUrl points to bus PC /driver on LAN (bus3-style)', () => {
  const join = buildDriverJoinUrl('http://192.168.1.50:5174/control?code=4821');
  assert.ok(join);
  const url = new URL(join);
  assert.equal(url.origin, 'http://192.168.1.50:5174');
  assert.equal(url.pathname, '/driver');
  assert.equal(url.search, '');
});

test('buildDriverJoinUrl ignores cloud PWA base — LAN only', () => {
  const join = buildDriverJoinUrl(
    'http://192.168.1.50:5174/control',
    'https://adkerala.com/driver',
  );
  assert.ok(join);
  const url = new URL(join);
  assert.equal(url.origin, 'http://192.168.1.50:5174');
  assert.equal(url.pathname, '/driver');
});

test('normalizeControlUrl maps /driver to /control', () => {
  assert.equal(
    normalizeControlUrl('http://192.168.1.50:5174/driver'),
    'http://192.168.1.50:5174/control',
  );
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
