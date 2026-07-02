import assert from 'node:assert/strict';
import { getFullscreenAdSchedule } from '../src/lib/adPlayback.js';

const now = 1_000_000;

assert.equal(
  getFullscreenAdSchedule(
    {
      displayOpenedAt: now,
      lastAdEndedAt: now - 60_000,
      adSettings: { initialDelaySec: 120, intervalSec: 90 },
    },
    now + 119_000
  ).ready,
  false
);

assert.equal(
  getFullscreenAdSchedule(
    {
      displayOpenedAt: now,
      lastAdEndedAt: now - 60_000,
      adSettings: { initialDelaySec: 120, intervalSec: 90 },
    },
    now + 120_000
  ).ready,
  true
);

assert.equal(
  getFullscreenAdSchedule(
    {
      displayOpenedAt: now,
      lastAdEndedAt: now + 200_000,
      adSettings: { initialDelaySec: 120, intervalSec: 90 },
    },
    now + 280_000
  ).ready,
  false
);

assert.equal(
  getFullscreenAdSchedule(
    {
      displayOpenedAt: now,
      lastAdEndedAt: now + 200_000,
      adSettings: { initialDelaySec: 120, intervalSec: 90 },
    },
    now + 290_000
  ).ready,
  true
);

console.log('adSchedule.test.mjs ok');
