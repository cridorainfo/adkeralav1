import test from 'node:test';
import assert from 'node:assert/strict';
import { isLanOrigin, isPrivateLanHost, isPhoneReachableHost } from '../cloud/shared/hub/lan.js';

test('isPrivateLanHost accepts RFC1918 addresses', () => {
  assert.equal(isPrivateLanHost('192.168.1.50'), true);
  // 10.x (other than the 10.255.x VPN-only range) is a legitimate, if deprioritized, LAN
  // range — matches server/networkInfo.js's own tiering, which still probes it as a fallback.
  assert.equal(isPrivateLanHost('10.0.0.5'), true);
  assert.equal(isPrivateLanHost('172.16.0.1'), true);
  assert.equal(isPrivateLanHost('192.168.137.1'), true);
});

test('isPrivateLanHost rejects public cloud hosts', () => {
  assert.equal(isPrivateLanHost('adkerala.com'), false);
  assert.equal(isPrivateLanHost('railway.app'), false);
});

test('isPrivateLanHost rejects VPN-only 10.255.x.x addresses', () => {
  assert.equal(isPrivateLanHost('10.255.253.156'), false);
});

test('isPhoneReachableHost only rejects the 10.255.x VPN-only subnet, not all 10.x', () => {
  assert.equal(isPhoneReachableHost('10.0.0.5'), true);
  assert.equal(isPhoneReachableHost('10.255.253.156'), false);
  assert.equal(isPhoneReachableHost('192.168.137.1'), true);
});

test('isLanOrigin accepts bus PC LAN origins', () => {
  assert.equal(isLanOrigin('http://192.168.1.50:5174'), true);
  assert.equal(isLanOrigin('http://127.0.0.1:5174'), true);
});

test('isLanOrigin rejects cloud origins', () => {
  assert.equal(isLanOrigin('https://adkerala.com'), false);
});
