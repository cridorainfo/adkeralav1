import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adHasPlayableMedia,
  findStopTriggeredAdIndex,
  nextPlayableAdIndex,
  effectiveWeeklyState,
  decrementAdQuota,
  weekStartMs,
} from '../src/lib/adPlayback.js';

// adHasPlayableMedia/nextPlayableAdIndex/findStopTriggeredAdIndex no longer trust the flat
// `ad.exhausted` boolean on its own — they recompute exhaustion from the decomposed reasons
// (exhaustedBySpend / playsRemaining / the weekly cap via effectiveWeeklyState) so a locally
// week-rolled-over ad can become playable again without a cloud round-trip clearing a stale
// `exhausted: true`. Real ads flowing through the system always have `exhausted` derived from
// these same decomposed fields (cloud/adExhaustion.js stampExhaustion, src/lib/adPlayback.js
// decrementAdQuota), so test fixtures below set the decomposed reason directly rather than the
// old flat-only shape.

test('adHasPlayableMedia rejects a money-budget-exhausted ad (exhaustedBySpend) even with valid media', () => {
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', exhaustedBySpend: true }), false);
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', exhaustedBySpend: false }), true);
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4' }), true);
});

test('adHasPlayableMedia rejects an ad whose money-budget play quota has hit 0', () => {
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', playsRemaining: 0 }), false);
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', playsRemaining: 1 }), true);
});

test('adHasPlayableMedia ignores a stale flat exhausted:true with none of the decomposed reasons set', () => {
  // Not realistic production data (stampExhaustion/decrementAdQuota always keep these in sync),
  // but proves the flat flag alone is no longer load-bearing — only the decomposed fields are.
  assert.equal(adHasPlayableMedia({ mediaUrl: 'x.mp4', exhausted: true }), true);
});

test('nextPlayableAdIndex skips money-budget-exhausted paid ads and falls back to a house ad', () => {
  const ads = [
    { id: 'paid-1', mediaUrl: 'a.mp4', exhaustedBySpend: true },
    { id: 'paid-2', mediaUrl: 'b.mp4', playsRemaining: 0 },
    { id: 'house-1', mediaUrl: 'c.mp4', isHouseAd: true },
  ];
  assert.equal(nextPlayableAdIndex(ads, 0), 2);
});

test('nextPlayableAdIndex returns -1 when every ad is exhausted and there are no house ads', () => {
  const ads = [
    { id: 'paid-1', mediaUrl: 'a.mp4', exhaustedBySpend: true },
    { id: 'paid-2', mediaUrl: 'b.mp4', playsRemaining: 0 },
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

test('findStopTriggeredAdIndex skips a money-budget-exhausted ad even if it matches the stop', () => {
  const ads = [{ id: 'a1', mediaUrl: 'a.mp4', triggerStopEn: 'main street', exhaustedBySpend: true }];
  assert.equal(findStopTriggeredAdIndex(ads, { en: 'Main Street' }, {}), -1);
});

// --- Weekly hard cap: effectiveWeeklyState / adHasPlayableMedia(ad, now) rollover ---

test('effectiveWeeklyState returns all-null for an ad with no weekly target', () => {
  const state = effectiveWeeklyState({ id: 'a' }, Date.now());
  assert.deepEqual(state, {
    weeklyPerBusTarget: null,
    weeklyViewsUsed: null,
    weeklyPlaysRemaining: null,
    weeklyWeekStartMs: null,
  });
});

test('effectiveWeeklyState returns stored counters unchanged when they belong to the current week', () => {
  const now = Date.parse('2026-03-11T10:00:00Z'); // a Wednesday
  const currentWeekStart = weekStartMs(now);
  const ad = {
    weeklyPerBusTarget: 10,
    weeklyViewsUsed: 4,
    weeklyPlaysRemaining: 6,
    weeklyWeekStartMs: currentWeekStart,
  };
  assert.deepEqual(effectiveWeeklyState(ad, now), {
    weeklyPerBusTarget: 10,
    weeklyViewsUsed: 4,
    weeklyPlaysRemaining: 6,
    weeklyWeekStartMs: currentWeekStart,
  });
});

test('effectiveWeeklyState resets to a fresh full allowance when the stored week has passed', () => {
  const lastWeek = Date.parse('2026-03-04T10:00:00Z'); // the previous Wednesday
  const now = Date.parse('2026-03-11T10:00:00Z'); // this Wednesday, a week later
  const ad = {
    weeklyPerBusTarget: 10,
    weeklyViewsUsed: 10,
    weeklyPlaysRemaining: 0,
    weeklyWeekStartMs: weekStartMs(lastWeek),
  };
  const state = effectiveWeeklyState(ad, now);
  assert.equal(state.weeklyViewsUsed, 0, 'used count must not carry over from a past week');
  assert.equal(state.weeklyPlaysRemaining, 10, 'must be a fresh full allowance, not the exhausted old one');
  assert.equal(state.weeklyWeekStartMs, weekStartMs(now));
});

test('adHasPlayableMedia rejects an ad that has hit its weekly cap for the current week', () => {
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ad = {
    mediaUrl: 'x.mp4',
    weeklyPerBusTarget: 10,
    weeklyViewsUsed: 10,
    weeklyPlaysRemaining: 0,
    weeklyWeekStartMs: weekStartMs(now),
  };
  assert.equal(adHasPlayableMedia(ad, now), false);
});

test('adHasPlayableMedia: the same ad object becomes playable again once `now` crosses into the next week', () => {
  const thisWeek = Date.parse('2026-03-11T10:00:00Z');
  const nextWeek = Date.parse('2026-03-18T10:00:00Z');
  const ad = {
    mediaUrl: 'x.mp4',
    weeklyPerBusTarget: 10,
    weeklyViewsUsed: 10,
    weeklyPlaysRemaining: 0,
    weeklyWeekStartMs: weekStartMs(thisWeek),
  };
  assert.equal(adHasPlayableMedia(ad, thisWeek), false, 'exhausted for the week it was capped in');
  assert.equal(adHasPlayableMedia(ad, nextWeek), true, 'playable again purely from the clock, no sync needed');
});

test('nextPlayableAdIndex skips a weekly-capped ad and falls back to a house ad', () => {
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ads = [
    {
      id: 'weekly-1',
      mediaUrl: 'a.mp4',
      weeklyPerBusTarget: 10,
      weeklyViewsUsed: 10,
      weeklyPlaysRemaining: 0,
      weeklyWeekStartMs: weekStartMs(now),
    },
    { id: 'house-1', mediaUrl: 'c.mp4', isHouseAd: true },
  ];
  assert.equal(nextPlayableAdIndex(ads, 0, now), 1);
});

// --- decrementAdQuota: local per-play decrement of both hard caps ---

test('decrementAdQuota decrements both playsRemaining and weeklyPlaysRemaining in one call', () => {
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ads = [
    {
      id: 'ad-1',
      mediaUrl: 'a.mp4',
      playsRemaining: 5,
      weeklyPerBusTarget: 10,
      weeklyViewsUsed: 4,
      weeklyPlaysRemaining: 6,
      weeklyWeekStartMs: weekStartMs(now),
    },
  ];
  const next = decrementAdQuota(ads, 'ad-1', now);
  assert.equal(next[0].playsRemaining, 4);
  assert.equal(next[0].weeklyViewsUsed, 5);
  assert.equal(next[0].weeklyPlaysRemaining, 5);
  assert.equal(next[0].exhausted, false);
});

test('decrementAdQuota floors each counter at 0 independently', () => {
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ads = [
    {
      id: 'ad-1',
      mediaUrl: 'a.mp4',
      playsRemaining: 0,
      weeklyPerBusTarget: 10,
      weeklyViewsUsed: 9,
      weeklyPlaysRemaining: 1,
      weeklyWeekStartMs: weekStartMs(now),
    },
  ];
  const next = decrementAdQuota(ads, 'ad-1', now);
  assert.equal(next[0].playsRemaining, 0, 'must not go negative');
  assert.equal(next[0].weeklyPlaysRemaining, 0);
  assert.equal(next[0].exhausted, true, 'both counters at 0 (one already, one just reached) must exhaust it');
});

test('decrementAdQuota applies a local week rollover before decrementing, not after', () => {
  const lastWeek = Date.parse('2026-03-04T10:00:00Z');
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ads = [
    {
      id: 'ad-1',
      mediaUrl: 'a.mp4',
      weeklyPerBusTarget: 10,
      weeklyViewsUsed: 10,
      weeklyPlaysRemaining: 0, // exhausted for last week
      weeklyWeekStartMs: weekStartMs(lastWeek),
      exhausted: true,
    },
  ];
  const next = decrementAdQuota(ads, 'ad-1', now);
  assert.equal(next[0].weeklyViewsUsed, 1, 'starts counting fresh for the new week, then this play makes it 1');
  assert.equal(next[0].weeklyPlaysRemaining, 9, 'not 0 - the rollover reset happened before the decrement');
  assert.equal(next[0].exhausted, false, 'must clear the stale exhausted flag once the rollover un-caps it');
  assert.equal(next[0].weeklyWeekStartMs, weekStartMs(now));
});

test('decrementAdQuota keeps exhausted true after a weekly rollover if exhaustedBySpend is also set', () => {
  const lastWeek = Date.parse('2026-03-04T10:00:00Z');
  const now = Date.parse('2026-03-11T10:00:00Z');
  const ads = [
    {
      id: 'ad-1',
      mediaUrl: 'a.mp4',
      exhaustedBySpend: true,
      weeklyPerBusTarget: 10,
      weeklyViewsUsed: 10,
      weeklyPlaysRemaining: 0,
      weeklyWeekStartMs: weekStartMs(lastWeek),
      exhausted: true,
    },
  ];
  const next = decrementAdQuota(ads, 'ad-1', now);
  assert.equal(next[0].exhausted, true, 'money-budget exhaustion is independent of the weekly cap rolling over');
});

test('decrementAdQuota leaves an ad with only a money-budget quota (no weekly target) unaffected by weekly logic', () => {
  const ads = [{ id: 'ad-1', mediaUrl: 'a.mp4', playsRemaining: 3 }];
  const next = decrementAdQuota(ads, 'ad-1', Date.now());
  assert.equal(next[0].playsRemaining, 2);
  assert.equal('weeklyPlaysRemaining' in next[0], false);
});

test('decrementAdQuota is a no-op (returns the same array reference) for an ad with neither quota', () => {
  const ads = [{ id: 'ad-1', mediaUrl: 'a.mp4' }];
  const next = decrementAdQuota(ads, 'ad-1', Date.now());
  assert.equal(next, ads);
});

test('decrementAdQuota leaves other ads in the array untouched', () => {
  const ads = [
    { id: 'ad-1', mediaUrl: 'a.mp4', playsRemaining: 3 },
    { id: 'ad-2', mediaUrl: 'b.mp4', playsRemaining: 7 },
  ];
  const next = decrementAdQuota(ads, 'ad-1', Date.now());
  assert.equal(next[1], ads[1], 'untouched ad should keep the same object reference');
  assert.equal(next[1].playsRemaining, 7);
});
