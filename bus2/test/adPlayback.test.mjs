import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adHasPlayableMedia,
  findStopTriggeredAdIndex,
  nextPlayableAdIndex,
} from '../src/lib/adPlayback.js';

test('adHasPlayableMedia rejects an exhausted ad even with valid media', () => {
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', exhausted: true }), false);
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', exhausted: false }), true);
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4' }), true);
});

test('nextPlayableAdIndex skips exhausted paid ads and falls back to a house ad', () => {
  const ads = [
    { id: 'paid-1', mediaUrl: 'a.mp4', exhausted: true },
    { id: 'paid-2', mediaUrl: 'b.mp4', exhausted: true },
    { id: 'house-1', mediaUrl: 'c.mp4', isHouseAd: true },
  ];
  assert.equal(nextPlayableAdIndex(ads, 0), 2);
});

test('nextPlayableAdIndex returns -1 when every ad is exhausted and there are no house ads', () => {
  const ads = [
    { id: 'paid-1', mediaUrl: 'a.mp4', exhausted: true },
    { id: 'paid-2', mediaUrl: 'b.mp4', exhausted: true },
  ];
  assert.equal(nextPlayableAdIndex(ads, 0), -1);
});

test('findStopTriggeredAdIndex matches an ad pinned to the upcoming stop', () => {
  const ads = [
    { id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street' },
    { id: 'a2', mediaUrl: 'b.mp4' },
  ];
  const state = { currentStopIndex: 2, lastStopAdTriggerStopIndex: null };
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Main Street' }, state), 0);
});

test('findStopTriggeredAdIndex does not re-trigger for the same stop approach twice', () => {
  const ads = [{ id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street' }];
  const state = { currentStopIndex: 2, lastStopAdTriggerStopIndex: 2 };
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Main Street' }, state), -1);
});

test('findStopTriggeredAdIndex re-arms once the bus moves to a different stop', () => {
  const ads = [{ id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street' }];
  const state = { currentStopIndex: 3, lastStopAdTriggerStopIndex: 2 };
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Main Street' }, state), 0);
});

test('findStopTriggeredAdIndex returns -1 with no upcoming stop or no match', () => {
  const ads = [{ id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street' }];
  assert.equal(findStopTriggeredAdIndex(ads, null, {}), -1);
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Other Stop' }, {}), -1);
});

test('findStopTriggeredAdIndex skips an exhausted ad even if it matches the stop', () => {
  const ads = [{ id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street', exhausted: true }];
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Main Street' }, {}), -1);
});
