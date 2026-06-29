import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialValueParser } from '../src/lib/serialValueParser.js';
import { createSerialActionGate } from '../src/lib/serialActionGate.js';
import { defaultState } from '../src/store/busStore.js';

/** Mirrors useEspSerialControl handleValueChange for automated verification. */
function createEspHandler(actions, getState) {
  const gate = createSerialActionGate({ debounceMs: 0 });
  const settings = () => getState().serialSettings ?? {};

  return (rawValue) => {
    const currentState = getState();
    const mappings = settings().buttonMappings ?? {};
    const normalized = String(rawValue)
      .trim()
      .toLowerCase()
      .replace(/[^\x20-\x7e]/g, '');

    const forward = String(mappings.forward ?? '1').trim().toLowerCase();
    const backward = String(mappings.backward ?? '2').trim().toLowerCase();
    const speech = String(mappings.speech ?? '3').trim().toLowerCase();
    const idle = String(mappings.idle ?? '0').trim().toLowerCase();

    if (normalized === idle) {
      gate.markIdle();
      return;
    }
    if (!gate.tryAction()) return;

    if (normalized === forward) {
      if (!currentState.tripStarted && !currentState.tripEnded) {
        actions.startTrip?.();
        return;
      }
      actions.moveForward?.();
      return;
    }
    if (normalized === backward) {
      actions.undoForward?.();
      return;
    }
    if (normalized === speech) {
      actions.requestAnnouncement?.();
    }
  };
}

function feedEsp32(parser, sequence) {
  for (const ch of sequence) parser.feed(ch);
}

test('ESP32 1/2/3/0 map to forward, undo, announce, idle', () => {
  const calls = [];
  let state = {
    ...defaultState(),
    tripStarted: true,
    tripEnded: false,
    serialSettings: defaultState().serialSettings,
  };

  const handler = createEspHandler(
    {
      startTrip: () => calls.push('startTrip'),
      moveForward: () => calls.push('moveForward'),
      undoForward: () => calls.push('undoForward'),
      requestAnnouncement: () => calls.push('requestAnnouncement'),
    },
    () => state
  );

  const parser = createSerialValueParser(handler);
  // Each action must be preceded by idle (0) after the previous press.
  feedEsp32(parser, '103020301020');
  assert.deepEqual(calls, [
    'moveForward',
    'requestAnnouncement',
    'undoForward',
    'requestAnnouncement',
    'moveForward',
    'undoForward',
  ]);
});

test('first press of 1 starts trip when not started', () => {
  const calls = [];
  let state = { ...defaultState(), tripStarted: false, tripEnded: false };

  const handler = createEspHandler(
    {
      startTrip: () => {
        calls.push('startTrip');
        state = { ...state, tripStarted: true };
      },
      moveForward: () => calls.push('moveForward'),
    },
    () => state
  );

  const parser = createSerialValueParser(handler);
  feedEsp32(parser, '101');
  assert.deepEqual(calls, ['startTrip', 'moveForward']);
});

test('held button without idle does not repeat', () => {
  const calls = [];
  const handler = createEspHandler({ moveForward: () => calls.push('moveForward') }, () => ({
    ...defaultState(),
    tripStarted: true,
  }));

  const parser = createSerialValueParser(handler);
  parser.feed('1');
  parser.feed('1');
  parser.feed('1');
  assert.deepEqual(calls, ['moveForward']);

  parser.feed('0');
  parser.feed('1');
  assert.deepEqual(calls, ['moveForward', 'moveForward']);
});
