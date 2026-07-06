import test from 'node:test';
import assert from 'node:assert/strict';
import { isLanOrigin, isPrivateLanHost } from '../cloud/shared/hub/lan.js';

test('isPrivateLanHost accepts RFC1918 addresses', () => {
  assert.equal(isPrivateLanHost('192.168.1.50'), true);
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

test('isLanOrigin accepts bus PC LAN origins', () => {
  assert.equal(isLanOrigin('http://192.168.1.50:5174'), true);
  assert.equal(isLanOrigin('http://127.0.0.1:5174'), true);
});

test('isLanOrigin rejects cloud origins', () => {
  assert.equal(isLanOrigin('https://adkerala.com'), false);
});
