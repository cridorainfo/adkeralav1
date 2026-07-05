import test from 'node:test';
import assert from 'node:assert/strict';
import { readDevicesDisconnectAt } from '../server/hubSessions.js';

function cloudDisconnectAlreadyApplied(current = {}, cloudAt = null) {
  if (!cloudAt) return true;
  const applied = readDevicesDisconnectAt(current);
  if (!applied) return false;
  if (String(cloudAt) === String(applied)) return true;
  const cloudMs = Date.parse(cloudAt);
  const appliedMs = Date.parse(applied);
  if (Number.isFinite(cloudMs) && Number.isFinite(appliedMs) && appliedMs >= cloudMs) {
    return true;
  }
  return false;
}

test('cloud disconnect stamp is not re-applied after bus already acked', () => {
  const stamp = '2026-07-05T15:31:04.135Z';
  const current = {
    busProfile: { devicesDisconnectLastApplied: stamp },
    tripStarted: true,
  };
  assert.equal(cloudDisconnectAlreadyApplied(current, stamp), true);
});

test('cloud disconnect stamp applies once when bus has no ack yet', () => {
  const stamp = '2026-07-05T15:31:04.135Z';
  assert.equal(cloudDisconnectAlreadyApplied({ busProfile: {} }, stamp), false);
});

test('older cloud disconnect stamp is ignored when bus ack is newer', () => {
  const current = {
    busProfile: { devicesDisconnectLastApplied: '2026-07-05T16:00:00.000Z' },
  };
  assert.equal(
    cloudDisconnectAlreadyApplied(current, '2026-07-05T15:31:04.135Z'),
    true
  );
});
