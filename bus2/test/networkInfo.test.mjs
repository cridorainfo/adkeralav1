import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNetworkUrls,
  controlIpForPhones,
  isVirtualNicName,
  lanAddressTier,
  pickPrimaryLanAddress,
  preferredProbeTiers,
  rankLanAddresses,
} from '../server/networkInfo.js';
import { isVpnOnlyAddress } from '../cloud/shared/hub/lan.js';

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

test('pickPrimaryLanAddress prefers 192.168 Wi-Fi over 10.x VPN-style address', () => {
  const ip = pickPrimaryLanAddress([
    { name: 'Ethernet', address: '10.255.253.156' },
    { name: 'Wi-Fi', address: '192.168.1.42' },
  ]);
  assert.equal(ip, '192.168.1.42');
});

test('isVirtualNicName flags common VPN adapter names', () => {
  assert.equal(isVirtualNicName('NordLynx'), true);
  assert.equal(isVirtualNicName('OpenVPN TAP-Windows6'), true);
  assert.equal(isVirtualNicName('Cisco AnyConnect'), true);
  assert.equal(isVirtualNicName('Wi-Fi'), false);
});

test('preferredProbeTiers ignores 10.x when 192.168 is available', () => {
  const plan = preferredProbeTiers([
    { name: 'Ethernet', address: '10.255.253.156' },
    { name: 'Wi-Fi', address: '192.168.1.42' },
  ]);
  assert.deepEqual(plan.tiers, [1]);
  assert.equal(plan.ranked[0].address, '192.168.1.42');
});

test('lanAddressTier ranks phone-friendly subnets first', () => {
  assert.equal(lanAddressTier('192.168.1.1'), 1);
  assert.equal(lanAddressTier('172.20.0.1'), 2);
  assert.equal(lanAddressTier('10.255.253.156'), 3);
});

test('rankLanAddresses orders hotspot and Wi-Fi ahead of 10.x ethernet', () => {
  const ranked = rankLanAddresses([
    { name: 'Ethernet', address: '10.255.253.156' },
    { name: 'Wi-Fi', address: '192.168.137.1' },
    { name: 'Ethernet', address: '192.168.0.5' },
  ]);
  assert.equal(ranked[0].address, '192.168.137.1');
  assert.equal(ranked[1].address, '192.168.0.5');
  assert.equal(ranked[2].address, '10.255.253.156');
});

test('pickPrimaryLanAddress ignores VPN-only 10.255.x.x when no 192.168 exists', () => {
  const ip = pickPrimaryLanAddress([{ name: 'Ethernet', address: '10.255.253.156' }]);
  assert.equal(ip, '127.0.0.1');
});

test('isVpnOnlyAddress flags 10.255.0.0/16', () => {
  assert.equal(isVpnOnlyAddress('10.255.253.156'), true);
  assert.equal(isVpnOnlyAddress('10.0.0.5'), false);
});
