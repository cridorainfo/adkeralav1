import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBusProfile } from '../src/store/busProfileMerge.js';

test('mergeBusProfile keeps existing pairing code from bus PC', () => {
  const merged = mergeBusProfile(
    { pairingCode: '4821', plate: 'KL01' },
    { pairingCode: '9999' }
  );
  assert.equal(merged.pairingCode, '4821');
});

test('mergeBusProfile accepts forced pairing code on disconnect-all', () => {
  const merged = mergeBusProfile(
    { pairingCode: '4821' },
    { pairingCode: '7392' },
    { forcePairingCode: true }
  );
  assert.equal(merged.pairingCode, '7392');
});

test('mergeBusProfile fills pairing code when bus has none yet', () => {
  const merged = mergeBusProfile({}, { pairingCode: '4821' });
  assert.equal(merged.pairingCode, '4821');
});
