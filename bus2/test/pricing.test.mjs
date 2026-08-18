import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAdSpend,
  isAdExhausted,
  isPeakMinute,
  minuteOfDay,
  computeWeeklyPlaysRemaining,
} from '../cloud/pricing.js';

test('minuteOfDay converts a UTC timestamp to Asia/Kolkata minute-of-day', () => {
  // 2026-01-01T02:30:00Z = 08:00 IST (UTC+5:30) = 480 minutes since midnight.
  const ts = Date.parse('2026-01-01T02:30:00Z');
  assert.equal(minuteOfDay(ts), 480);
});

test('isPeakMinute matches inside a window and excludes the exclusive end boundary', () => {
  const peakHours = [{ startMin: 420, endMin: 540 }]; // 7:00-9:00
  assert.equal(isPeakMinute(420, peakHours), true);
  assert.equal(isPeakMinute(479, peakHours), true);
  assert.equal(isPeakMinute(540, peakHours), false);
  assert.equal(isPeakMinute(300, peakHours), false);
});

test('isPeakMinute supports multiple windows (morning + evening rush)', () => {
  const peakHours = [
    { startMin: 420, endMin: 540 }, // 7-9am
    { startMin: 1020, endMin: 1140 }, // 5-7pm
  ];
  assert.equal(isPeakMinute(450, peakHours), true);
  assert.equal(isPeakMinute(1080, peakHours), true);
  assert.equal(isPeakMinute(720, peakHours), false);
});

test('computeAdSpend splits peak/off-peak seconds and applies the right rate to each', () => {
  const pricingSettings = { ratePerSecond: 1, peakRatePerSecond: 3, peakHours: [{ startMin: 420, endMin: 540 }] };
  const peakTs = Date.parse('2026-01-01T02:30:00Z'); // 08:00 IST — inside peak
  const offPeakTs = Date.parse('2026-01-01T08:30:00Z'); // 14:00 IST — outside peak
  const plays = [
    { playedAt: peakTs, durationPlayedSec: 10 },
    { playedAt: offPeakTs, durationPlayedSec: 20 },
  ];
  const result = computeAdSpend(plays, 'fullscreen', pricingSettings);
  assert.equal(result.peakSec, 10);
  assert.equal(result.offPeakSec, 20);
  assert.equal(result.spend, 10 * 3 + 20 * 1);
});

test('computeAdSpend handles an empty play list', () => {
  const result = computeAdSpend([], { ratePerSecond: 1, peakRatePerSecond: 3, peakHours: [] });
  assert.deepEqual(result, { peakSec: 0, offPeakSec: 0, spend: 0 });
});

test('isAdExhausted never exhausts an ad with no budget set', () => {
  assert.equal(isAdExhausted(null, 999999), false);
  assert.equal(isAdExhausted(0, 999999), false);
  assert.equal(isAdExhausted(undefined, 999999), false);
});

test('isAdExhausted flags exactly-at and over budget, not under', () => {
  assert.equal(isAdExhausted(100, 99), false);
  assert.equal(isAdExhausted(100, 100), true);
  assert.equal(isAdExhausted(100, 101), true);
});

test('computeWeeklyPlaysRemaining subtracts used from target', () => {
  assert.equal(computeWeeklyPlaysRemaining(10, 4), 6);
  assert.equal(computeWeeklyPlaysRemaining(10, 0), 10);
});

test('computeWeeklyPlaysRemaining floors at 0, never negative', () => {
  assert.equal(computeWeeklyPlaysRemaining(10, 10), 0);
  assert.equal(computeWeeklyPlaysRemaining(10, 15), 0);
});

test('computeWeeklyPlaysRemaining returns null when there is no weekly target', () => {
  assert.equal(computeWeeklyPlaysRemaining(0, 5), null);
  assert.equal(computeWeeklyPlaysRemaining(null, 5), null);
  assert.equal(computeWeeklyPlaysRemaining(undefined, 5), null);
  assert.equal(computeWeeklyPlaysRemaining(-3, 5), null);
});

test('computeWeeklyPlaysRemaining treats a missing/non-numeric weeklyViewsUsed as 0', () => {
  assert.equal(computeWeeklyPlaysRemaining(10, undefined), 10);
  assert.equal(computeWeeklyPlaysRemaining(10, null), 10);
});
