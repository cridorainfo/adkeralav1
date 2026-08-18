import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlayScheduleItem, applyEndScheduleItem } from '../src/store/scheduleActions.js';

function scheduleWithItems(n) {
  return {
    schedule: {
      items: Array.from({ length: n }, (_, i) => ({ id: `item-${i}`, kind: 'video', mediaFile: `x/${i}.mp4` })),
      currentIndex: 0,
      loopCount: 0,
    },
  };
}

test('applyPlayScheduleItem sets currentIndex and itemStartedAt on a fresh call', () => {
  const state = scheduleWithItems(3);
  const next = applyPlayScheduleItem(state, 1);
  assert.equal(next.schedule.currentIndex, 1);
  assert.ok(next.schedule.itemStartedAt > 0);
});

test('applyPlayScheduleItem no-ops (does not bump itemStartedAt) when re-called for the same already-started item', () => {
  const state = scheduleWithItems(3);
  const first = applyPlayScheduleItem(state, 1);
  const second = applyPlayScheduleItem(first, 1);
  assert.equal(second, first, 'should return the exact same state reference, not a new one');
});

test('applyPlayScheduleItem clamps an out-of-range index via modulo wrap', () => {
  const state = scheduleWithItems(3);
  const next = applyPlayScheduleItem(state, 5); // 5 % 3 === 2
  assert.equal(next.schedule.currentIndex, 2);
});

test('applyPlayScheduleItem no-ops on an empty playlist', () => {
  const state = { schedule: { items: [], currentIndex: 0 } };
  const next = applyPlayScheduleItem(state, 0);
  assert.equal(next, state);
});

test('applyEndScheduleItem advances to the next item without touching loopCount for a middle item', () => {
  const state = applyPlayScheduleItem(scheduleWithItems(3), 0);
  const next = applyEndScheduleItem(state);
  assert.equal(next.schedule.currentIndex, 1);
  assert.equal(next.schedule.loopCount, 0);
});

test('applyEndScheduleItem only wraps to item 0 (and increments loopCount) after every other item has played', () => {
  let state = scheduleWithItems(4);
  // Item 0 -> 1 -> 2 -> 3, none of these wrap.
  for (let i = 0; i < 3; i++) {
    state = applyEndScheduleItem(state);
    assert.equal(state.schedule.currentIndex, i + 1, `after ending item ${i}, should be on item ${i + 1}`);
    assert.equal(state.schedule.loopCount, 0, `loopCount must not increment until the full list has played`);
  }
  // Ending item 3 (the last one) is the one wrap point.
  state = applyEndScheduleItem(state);
  assert.equal(state.schedule.currentIndex, 0, 'only now should it wrap back to item 0');
  assert.equal(state.schedule.loopCount, 1);
});

test('applyEndScheduleItem on a single-item playlist wraps to itself and still increments loopCount every time', () => {
  let state = scheduleWithItems(1);
  state = applyEndScheduleItem(state);
  assert.equal(state.schedule.currentIndex, 0);
  assert.equal(state.schedule.loopCount, 1);
  state = applyEndScheduleItem(state);
  assert.equal(state.schedule.loopCount, 2);
});

test('applyEndScheduleItem no-ops on an empty playlist', () => {
  const state = { schedule: { items: [], currentIndex: 0, loopCount: 0 } };
  const next = applyEndScheduleItem(state);
  assert.equal(next, state);
});

test('applyEndScheduleItem stamps lastItemEndedAt and a fresh itemStartedAt', () => {
  const state = scheduleWithItems(2);
  const next = applyEndScheduleItem(state);
  assert.ok(next.schedule.lastItemEndedAt > 0);
  assert.ok(next.schedule.itemStartedAt > 0);
});
