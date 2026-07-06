import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDriverJoinUrl, buildDriverQrUrl, readPairingCodeFromLocation } from '../src/lib/driverJoinUrl.js';
import {
  normalizeControlUrl,
  readHubControlFromLocation,
  saveHubControlUrl,
  clearHubSetup,
  hasStoredDriverCredentials,
  saveHubPairCode,
  saveHubSession,
} from '../cloud/shared/hub/persist.js';
import { shouldOpenHubControl } from '../cloud/shared/hub/client.js';

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

test('buildDriverJoinUrl rejects VPN-only 10.255.x.x bus URLs', () => {
  assert.equal(buildDriverJoinUrl('http://10.255.253.156:5174/control'), null);
});

test('buildDriverQrUrl is the local LAN driver URL only', () => {
  const qr = buildDriverQrUrl({
    controlUrlHttp: 'http://192.168.137.1:5174/control',
  });
  assert.equal(qr, 'http://192.168.137.1:5174/driver');
});

test('buildDriverQrUrl has no pairing code or cloud host', () => {
  const qr = buildDriverQrUrl({
    controlUrlHttp: 'http://192.168.1.50:5174/control',
  });
  const url = new URL(qr);
  assert.equal(url.hostname, '192.168.1.50');
  assert.equal(url.search, '');
});

test('buildDriverQrUrl returns null when no phone-reachable LAN IP', () => {
  assert.equal(
    buildDriverQrUrl({ controlUrlHttp: 'http://10.255.253.156:5174/control' }),
    null
  );
  assert.equal(buildDriverQrUrl({ controlUrlHttp: null }), null);
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
  assert.equal(saveHubControlUrl('http://10.255.253.156:5174/control'), null);
  assert.equal(saveHubControlUrl('http://10.0.0.5:5174/control'), null);
});

test('readPairingCodeFromLocation reads legacy code param', () => {
  assert.equal(readPairingCodeFromLocation('?code=4821'), '4821');
});

test('hasStoredDriverCredentials after first pair', () => {
  clearHubSetup();
  assert.equal(hasStoredDriverCredentials(), false);
  saveHubControlUrl('http://192.168.1.50:5174/control');
  assert.equal(hasStoredDriverCredentials(), false);
  saveHubPairCode('4821');
  assert.equal(hasStoredDriverCredentials(), true);
  clearHubSetup();
  saveHubSession({ token: 'abc', origin: 'http://192.168.1.50:5174' });
  assert.equal(hasStoredDriverCredentials(), true);
  clearHubSetup();
});

test('shouldOpenHubControl skips pairing screen for saved session while reconnecting', () => {
  clearHubSetup();
  saveHubControlUrl('http://192.168.1.50:5174/control');
  saveHubPairCode('4821');
  assert.equal(
    shouldOpenHubControl({
      ok: false,
      status: 'reconnecting',
      controlUrl: 'http://192.168.1.50:5174/control',
      keepTrying: true,
    }),
    true
  );
  clearHubSetup();
});

test('shouldOpenHubControl keeps first-time driver on connect page', () => {
  clearHubSetup();
  assert.equal(
    shouldOpenHubControl({
      ok: false,
      status: 'need-code',
      controlUrl: 'http://192.168.1.50:5174/control',
    }),
    false
  );
});
