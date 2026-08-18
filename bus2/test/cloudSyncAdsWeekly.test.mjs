import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { reconcileAdsWeeklyFields, syncAdsFromCloud } from '../server/cloudSync.js';
import { readInfoFile, writeInfoFile, getDbPaths } from '../server/dbApi.js';
import { weekStartMs } from '../src/lib/adPlayback.js';

const NOW = Date.parse('2026-03-11T10:00:00Z'); // a Wednesday
const THIS_WEEK = weekStartMs(NOW);
const LAST_WEEK = weekStartMs(Date.parse('2026-03-04T10:00:00Z'));

test('reconcileAdsWeeklyFields: same week, cloud count higher than device — cloud wins (normal converge)', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 4, weeklyWeekStartMs: THIS_WEEK }];
  const next = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 6, weeklyWeekStartMs: THIS_WEEK }];
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal(result[0].weeklyViewsUsed, 6);
  assert.equal(result[0].weeklyPlaysRemaining, 4);
});

test('reconcileAdsWeeklyFields: same week, device count higher (offline plays not yet uploaded) — device wins, not regressed', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 7, weeklyWeekStartMs: THIS_WEEK }];
  const next = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 4, weeklyWeekStartMs: THIS_WEEK }];
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal(result[0].weeklyViewsUsed, 7, 'must not regress the device\'s own further-ahead count');
  assert.equal(result[0].weeklyPlaysRemaining, 3);
});

test('reconcileAdsWeeklyFields: device already rolled over locally but cloud is still stamped for last week — device\'s fresh reset wins', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 0, weeklyWeekStartMs: THIS_WEEK }];
  // Cloud hasn't synced since before the week rolled over — its stamp still says last week, fully used.
  const next = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 10, weeklyWeekStartMs: LAST_WEEK }];
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal(result[0].weeklyViewsUsed, 0, 'the old week\'s exhausted count must not leak into the new week');
  assert.equal(result[0].weeklyPlaysRemaining, 10);
  assert.equal(result[0].weeklyWeekStartMs, THIS_WEEK);
});

test('reconcileAdsWeeklyFields: both sides agree on the new week, cloud has a higher count (paired-device plays) — cloud\'s max wins', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 2, weeklyWeekStartMs: THIS_WEEK }];
  const next = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 5, weeklyWeekStartMs: THIS_WEEK }];
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal(result[0].weeklyViewsUsed, 5);
});

test('reconcileAdsWeeklyFields: admin removed the weekly target — dropped cleanly, no crash on a stale current entry', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 4, weeklyWeekStartMs: THIS_WEEK }];
  const next = [{ id: 'ad-1', mediaUrl: 'a.mp4' }]; // no weeklyPerBusTarget anymore
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal('weeklyPerBusTarget' in result[0], false);
});

test('reconcileAdsWeeklyFields: exhausted reflects the merged weekly cap alongside money-budget reasons', () => {
  const current = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 9, weeklyWeekStartMs: THIS_WEEK }];
  const next = [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 10, weeklyWeekStartMs: THIS_WEEK }];
  const result = reconcileAdsWeeklyFields(current, next, NOW);
  assert.equal(result[0].weeklyPlaysRemaining, 0);
  assert.equal(result[0].exhausted, true);
});

test('reconcileAdsWeeklyFields: a new ad with no matching current entry just uses the cloud stamp as-is', () => {
  const result = reconcileAdsWeeklyFields([], [{ id: 'ad-1', weeklyPerBusTarget: 10, weeklyViewsUsed: 0, weeklyWeekStartMs: THIS_WEEK }], NOW);
  assert.equal(result[0].weeklyViewsUsed, 0);
  assert.equal(result[0].weeklyPlaysRemaining, 10);
});

// --- End-to-end: syncAdsFromCloud writes the reconciled result, not a blind overwrite ---

async function makeTempDataRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adkerala-ads-sync-'));
  const { mediaDir } = getDbPaths(root);
  await fs.mkdir(mediaDir, { recursive: true });
  return root;
}

function startFakeCloud(adsResponse) {
  const server = http.createServer((req, res) => {
    if (req.url.includes('/ads')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...adsResponse }));
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ cloudUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('syncAdsFromCloud reconciles weekly fields instead of blindly overwriting them', async () => {
  const dataRoot = await makeTempDataRoot();
  // syncAdsFromCloud has no injectable clock (it calls Date.now() internally), so this test uses
  // the real current week rather than the fixed March-2026 date the pure-function tests above use.
  const realThisWeek = weekStartMs(Date.now());
  // Device is offline-ahead: already at 7 plays this week per its own local decrementing.
  await writeInfoFile(dataRoot, {
    ads: [{ id: 'ad-1', mediaUrl: 'a.mp4', weeklyPerBusTarget: 10, weeklyViewsUsed: 7, weeklyWeekStartMs: realThisWeek }],
    bannerAds: [],
    adsSavedAt: 100,
    savedAt: 100,
  });

  const cloud = await startFakeCloud({
    ads: [{ id: 'ad-1', mediaUrl: 'a.mp4', weeklyPerBusTarget: 10, weeklyViewsUsed: 4, weeklyWeekStartMs: realThisWeek }],
    bannerAds: [],
    adsSavedAt: 200, // newer than local, so this sync is treated as a real change
  });

  await syncAdsFromCloud(dataRoot, { cloudUrl: cloud.cloudUrl, busId: 'bus-1', deviceToken: 'tok' });

  const written = await readInfoFile(dataRoot);
  assert.equal(written.ads[0].weeklyViewsUsed, 7, 'must not regress the device\'s own further-ahead weekly count');

  await cloud.close();
});
