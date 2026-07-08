import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnouncementSequence } from '../src/lib/audioFragments.js';

function baseState(overrides = {}) {
  return {
    audioFragments: {
      attention: { en: { audioUrl: 'attention-en.mp3' } },
      nextStop: { en: { audioUrl: 'nextstop-en.mp3' } },
      pleaseAlight: { en: { audioUrl: 'alight-en.mp3' } },
    },
    stopAudio: {},
    announcementSettings: { languages: ['en'], pauseBetweenFragmentsMs: 300 },
    ...overrides,
  };
}

test('buildAnnouncementSequence appends the voice ad once at the end when enabled', () => {
  const state = baseState({
    stopAudio: {
      'main street': { en: { audioUrl: 'mainstreet-en.mp3' }, ad: { audioUrl: 'ad.mp3' }, adEnabled: true },
    },
  });
  const seq = buildAnnouncementSequence(state, { en: 'Main Street' });
  const urls = seq.filter((item) => typeof item === 'string');
  assert.deepEqual(urls, [
    'attention-en.mp3',
    'nextstop-en.mp3',
    'mainstreet-en.mp3',
    'alight-en.mp3',
    'ad.mp3',
  ]);
  // A pause separates the ad from the rest of the announcement.
  assert.ok(seq[seq.length - 2]?.pause);
});

test('buildAnnouncementSequence omits the voice ad when the per-stop toggle is off', () => {
  const state = baseState({
    stopAudio: {
      'main street': { en: { audioUrl: 'mainstreet-en.mp3' }, ad: { audioUrl: 'ad.mp3' }, adEnabled: false },
    },
  });
  const seq = buildAnnouncementSequence(state, { en: 'Main Street' });
  assert.ok(!seq.includes('ad.mp3'));
});

test('buildAnnouncementSequence omits the voice ad when no clip is assigned even if toggled on', () => {
  const state = baseState({
    stopAudio: { 'main street': { en: { audioUrl: 'mainstreet-en.mp3' }, adEnabled: true } },
  });
  const seq = buildAnnouncementSequence(state, { en: 'Main Street' });
  assert.ok(!seq.some((item) => typeof item === 'string' && item.includes('ad')));
});

test('buildAnnouncementSequence never adds a voice ad to an otherwise-empty announcement', () => {
  const state = {
    audioFragments: {},
    stopAudio: { 'main street': { ad: { audioUrl: 'ad.mp3' }, adEnabled: true } },
    announcementSettings: { languages: ['en'] },
  };
  const seq = buildAnnouncementSequence(state, { en: 'Main Street' });
  assert.deepEqual(seq, []);
});
