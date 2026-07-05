import test from 'node:test';
import assert from 'node:assert/strict';
import { createSerialActionGate } from '../src/lib/serialActionGate.js';

test('requires idle before next action', () => {
  const gate = createSerialActionGate({ debounceMs: 0 });

  assert.equal(gate.tryAction(), true);
  assert.equal(gate.tryAction(), false);

  gate.markIdle();
  assert.equal(gate.tryAction(), true);
});

test('re-arms after debounce without explicit idle', () => {
  const gate = createSerialActionGate({ debounceMs: 50 });

  assert.equal(gate.tryAction(), true);
  assert.equal(gate.tryAction(), false);

  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(gate.tryAction(), true);
      resolve();
    }, 60);
  });
});

test('enforces debounce cooldown', () => {
  const gate = createSerialActionGate({ debounceMs: 100 });
  gate.markIdle();

  assert.equal(gate.tryAction(), true);
  gate.markIdle();
  assert.equal(gate.tryAction(), false);

  gate.reset();
  gate.markIdle();
  assert.equal(gate.tryAction(), true);
});
