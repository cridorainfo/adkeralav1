import test from 'node:test';
import assert from 'node:assert/strict';
import { isCloudOnline, isUpdateDownloading } from '../src/lib/displayStatus.js';

test('isCloudOnline uses recent lastCloudPushAt', () => {
  const now = 1_000_000;
  assert.equal(isCloudOnline(now - 10_000, now), true);
  assert.equal(isCloudOnline(now - 60_000, now), false);
  assert.equal(isCloudOnline(0, now), false);
});

test('isUpdateDownloading is true only during download phase', () => {
  assert.equal(isUpdateDownloading(null), false);
  assert.equal(isUpdateDownloading({ visible: true, phase: 'downloading' }), true);
  assert.equal(isUpdateDownloading({ visible: true, phase: 'downloaded' }), false);
});
