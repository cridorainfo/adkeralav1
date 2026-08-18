/**
 * Entertainment-mode playlist playback (Schedules feature) reducers — extracted out of
 * BusStoreProvider.jsx's playScheduleItem/endScheduleItem `useCallback` bodies so this
 * business-critical sequencing logic (which video plays next, when the whole playlist wraps) is
 * directly unit-testable without React/hook machinery, mirroring driveActions.js's shape: pure
 * `(state, ...) => nextState` functions that BusStoreProvider.jsx imports and wraps in thin
 * `update((s) => applyX(s))` callbacks. No behavior change from the code these replaced.
 */

/** Marks playlist item `index` as the one currently playing — records `itemStartedAt` so a
 * restart mid-item resumes at the same item (see endScheduleItem's doc comment) rather than
 * silently reusing whatever timestamp was already there. No-ops if `index` (after wrapping into
 * range) is already the current item and it's already been marked started, so re-invoking this
 * for the same item (e.g. a SchedulePlayer remount that lands back on the same index) doesn't
 * reset its start time. */
export function applyPlayScheduleItem(state, index) {
  const items = state.schedule?.items ?? [];
  if (!items.length) return state;
  const clamped = ((index % items.length) + items.length) % items.length;
  if (state.schedule?.currentIndex === clamped && state.schedule?.itemStartedAt) return state;
  return {
    ...state,
    schedule: { ...(state.schedule ?? {}), currentIndex: clamped, itemStartedAt: Date.now() },
  };
}

/** Current item finished (natural end or its durationSec elapsed) — advance to the next one,
 * wrapping to 0 and incrementing loopCount once the whole playlist has played through. This is
 * the one place loopCount ever increments, so "has it looped N times" always means "has it
 * reached the end of the list and wrapped N times" — every item plays exactly once before item 0
 * repeats, never a per-item repeat count. */
export function applyEndScheduleItem(state) {
  const items = state.schedule?.items ?? [];
  if (!items.length) return state;
  const current = state.schedule?.currentIndex ?? 0;
  const wrapped = current + 1 >= items.length;
  const nextIndex = wrapped ? 0 : current + 1;
  return {
    ...state,
    schedule: {
      ...(state.schedule ?? {}),
      currentIndex: nextIndex,
      loopCount: wrapped ? (state.schedule?.loopCount ?? 0) + 1 : (state.schedule?.loopCount ?? 0),
      lastItemEndedAt: Date.now(),
      itemStartedAt: Date.now(),
    },
  };
}
