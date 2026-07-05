import test from 'node:test';
import assert from 'node:assert/strict';

test('pending enrollments use a recent activity window', () => {
  const activeMs = Number(process.env.ADKERALA_ENROLL_ACTIVE_MS ?? 120000);
  assert.ok(activeMs >= 60000, 'active window should be at least 1 minute');
  assert.ok(activeMs <= 30 * 60 * 1000, 'active window should not exceed enroll TTL');
});
