import test from 'node:test';
import assert from 'node:assert/strict';
import { hubTimeoutSignal, HUB_FETCH_TIMEOUT_MS } from '#hub/api';

test('hubTimeoutSignal aborts after the given timeout instead of never', async () => {
  const signal = hubTimeoutSignal(10);
  assert.equal(signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(signal.aborted, true);
});

test('HUB_FETCH_TIMEOUT_MS is a sane, finite bound (not left to hang indefinitely)', () => {
  assert.ok(HUB_FETCH_TIMEOUT_MS > 0);
  assert.ok(HUB_FETCH_TIMEOUT_MS < 30000, 'should fail fast enough to feel responsive to a driver');
});
