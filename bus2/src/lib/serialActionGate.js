/**
 * Gates serial button actions to prevent bounce / noise from firing multiple times.
 * Requires idle between presses and enforces a cooldown after each action.
 */
export function createSerialActionGate({ debounceMs = 500 } = {}) {
  let lastActionAt = 0;
  let readyForPress = true;
  let rearmTimer = null;

  function scheduleRearm() {
    if (rearmTimer) clearTimeout(rearmTimer);
    rearmTimer = setTimeout(() => {
      rearmTimer = null;
      readyForPress = true;
    }, Math.max(debounceMs, 0));
  }

  return {
    markIdle() {
      readyForPress = true;
    },

    /** @returns {boolean} true if an action is allowed right now */
    tryAction() {
      if (!readyForPress) return false;

      const now = Date.now();
      if (now - lastActionAt < debounceMs) return false;

      lastActionAt = now;
      readyForPress = false;
      scheduleRearm();
      return true;
    },

    reset() {
      if (rearmTimer) clearTimeout(rearmTimer);
      rearmTimer = null;
      lastActionAt = 0;
      readyForPress = true;
    },
  };
}
