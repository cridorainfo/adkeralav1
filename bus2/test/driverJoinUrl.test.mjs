import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverJoinUrl, readPairingCodeFromLocation } from '../src/lib/driverJoinUrl.js';
import {
  normalizeControlUrl,
  readHubControlFromLocation,
  saveHubControlUrl,
  clearHubSetup,
} from '../cloud/shared/hub/persist.js';

test('buildDriverJoinUrl points to bus PC /driver on LAN (bus3-style)', () => {
  const join = buildDriverJoinUrl('http://192.168.1.50:5174/control?code=4821');
  assert.ok(join);
  const url = new URL(join);
  assert.equal(url.origin, 'http://192.168.1.50:5174');
  assert.equal(url.pathname, '/driver');
  assert.equal(url.search, '');
});

test('buildDriverJoinUrl rejects cloud URLs', () => {
  assert.equal(buildDriverJoinUrl('https://adkerala.com/control'), null);
  assert.equal(buildDriverJoinUrl('https://adkerala.com/driver'), null);
});

test('buildDriverJoinUrl accepts Windows hotspot gateway', () => {
  const join = buildDriverJoinUrl('http://192.168.137.1:5174/control');
  assert.equal(join, 'http://192.168.137.1:5174/driver');
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

test('readHubControlFromLocation reads control query param', () => {
  const raw = readHubControlFromLocation('?control=http%3A%2F%2F192.168.1.50%3A5174%2Fcontrol');
  assert.equal(raw, 'http://192.168.1.50:5174/control');
});

test('saveHubControlUrl rejects cloud control URLs', () => {
  clearHubSetup();
  assert.equal(saveHubControlUrl('https://adkerala.com/control'), null);
  assert.equal(saveHubControlUrl('http://192.168.1.50:5174/control'), 'http://192.168.1.50:5174/control');
});

test('readPairingCodeFromLocation reads legacy code param', () => {
  assert.equal(readPairingCodeFromLocation('?code=4821'), '4821');
});
