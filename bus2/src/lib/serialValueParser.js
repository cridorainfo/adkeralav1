/**
 * Parses a serial byte stream and emits only when the decoded value changes.
 * Handles newline-delimited lines and continuous single-digit streams from ESP32.
 */
export function createSerialValueParser(onValueChange, { textCommands = ['fullscreen', 'exit'] } = {}) {
  let buffer = '';
  let lastEmitted = null;

  const commandSet = new Set(
    textCommands.map((cmd) => String(cmd ?? '').trim().toLowerCase()).filter(Boolean)
  );

  function isMultiCharTextCommand(value) {
    return /^[a-zA-Z]{2,}$/.test(value.trim());
  }

  function emit(raw) {
    const value = raw.trim();
    if (!value) return;

    const key = value.toLowerCase();
    if (key === lastEmitted && !isMultiCharTextCommand(value)) return;

    lastEmitted = key;
    onValueChange(value);
  }

  /** Values sent without newline (continuous ESP stream) — digits only. */
  function stableDigitFromBuffer() {
    const trimmed = buffer.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) return null;
    return trimmed[0];
  }

  /** Text commands sent without newline (e.g. Serial.print("fullscreen")). */
  function tryEmitTextToken() {
    const trimmed = buffer.trim();
    if (!trimmed || !/^[a-zA-Z]+$/.test(trimmed)) return false;

    if (commandSet.has(trimmed.toLowerCase())) {
      emit(trimmed);
      buffer = '';
      return true;
    }

    return false;
  }

  function feed(text) {
    if (!text) return;

    buffer += text;

    // Complete lines (ESP Serial.println or text commands)
    while (true) {
      const match = buffer.match(/^([^\r\n]*)\r?\n/);
      if (!match) break;
      emit(match[1]);
      buffer = buffer.slice(match[0].length);
    }

    if (tryEmitTextToken()) return;

    // Continuous digit stream without newline (ESP Serial.print("1"))
    const digit = stableDigitFromBuffer();
    if (digit) {
      emit(digit);
      buffer = '';
    }

    if (buffer.length > 64) {
      buffer = buffer.slice(-32);
    }
  }

  function reset() {
    buffer = '';
    lastEmitted = null;
  }

  return { feed, reset };
}
