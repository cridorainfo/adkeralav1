import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetworkUrls,
  controlIpForPhones,
  pickPrimaryLanAddress,
} from '../server/networkInfo.js';

test('controlIpForPhones rejects loopback', () => {
  assert.equal(controlIpForPhones('127.0.0.1'), null);
  assert.equal(controlIpForPhones('192.168.1.8'), '192.168.1.8');
});

test('buildNetworkUrls omits control URL when only loopback is available', () => {
  const urls = buildNetworkUrls(5174, '0.0.0.0', { primaryIp: '127.0.0.1' });
  assert.equal(urls.controlUrlHttp, null);
  assert.equal(urls.primaryIp, null);
});

test('buildNetworkUrls uses probed LAN IP for driver control', () => {
  const urls = buildNetworkUrls(5174, '0.0.0.0', { primaryIp: '192.168.137.1', httpsEnabled: true });
  assert.equal(urls.controlUrlHttp, 'http://192.168.137.1:5174/control');
  assert.equal(urls.controlUrlHttps, 'https://192.168.137.1:5175/control');
});

test('pickPrimaryLanAddress prefers Windows hotspot gateway', () => {
  const ip = pickPrimaryLanAddress([
    { name: 'Ethernet', address: '192.168.1.8' },
    { name: 'Wi-Fi', address: '192.168.137.1' },
  ]);
  assert.equal(ip, '192.168.137.1');
});
