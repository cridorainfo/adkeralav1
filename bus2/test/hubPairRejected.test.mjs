import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { setupDbApi, ensureDbLayout, writeInfoFile } from '../server/dbApi.js';
import { initHubSessions, resetHubSessionsForTests, setupHubSessions } from '../server/hubSessions.js';
import { setupDriveApi } from '../server/driveApi.js';
import { pairToHub, ensureHubConnected, shouldOpenHubControl } from '#hub/client';
import { clearHubSetup, saveHubControlUrl, saveHubPairCode } from '#hub/persist';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startTestServer() {
  resetHubSessionsForTests();
  const testRoot = path.join(
    __dirname,
    `.tmp-hub-rejected-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await fs.rm(testRoot, { recursive: true, force: true });
  await ensureDbLayout(testRoot);
  await writeInfoFile(testRoot, {
    routes: [],
    activeRouteId: null,
    savedAt: Date.now(),
    busProfile: { plate: 'KL01AB1234', plateDisplay: 'KL 01 AB 1234', pairingCode: '4821' },
    connectedDeviceCount: 0,
  });

  const app = express();
  app.use(express.json());
  await initHubSessions(testRoot);
  setupDbApi(app, testRoot);
  setupHubSessions(app, { dataRoot: testRoot });
  setupDriveApi(app, testRoot);

  // isPhoneReachableHost (cloud/shared/hub/lan.js) — which pairToHub/saveHubControlUrl gate
  // on — correctly rejects the literal '127.0.0.1' (a real phone can never reach a bus PC's
  // own loopback), but does accept the string 'localhost'. Bind and connect via 'localhost'
  // consistently so the same hostname resolution is used on both ends.
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const { port } = server.address();

  return {
    base: `http://localhost:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

test('pairToHub distinguishes a server-rejected code from a network failure', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  clearHubSetup();

  const wrong = await pairToHub(`${srv.base}/control`, '0000');
  assert.equal(wrong.ok, false);
  assert.equal(wrong.rejected, true);
  assert.equal(wrong.offline, undefined);

  clearHubSetup();
  // Nothing listening on this high loopback port — a genuine network failure (fast ECONNREFUSED
  // on loopback), not a server response. Avoid low/reserved ports: some OSes silently drop
  // rather than refuse them, which would hang until hubFetch's own timeout instead of failing
  // fast — exercise that path in the timeout test below instead.
  const offline = await pairToHub('http://localhost:59991/control', '4821');
  assert.equal(offline.ok, false);
  assert.equal(offline.offline, true);
  assert.equal(offline.rejected, undefined);

  clearHubSetup();
  const right = await pairToHub(`${srv.base}/control`, '4821');
  assert.equal(right.ok, true);
});

test('ensureHubConnected maps a rejected code to keepTrying=false, not "reconnecting"', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());
  clearHubSetup();

  saveHubControlUrl(`${srv.base}/control`);
  saveHubPairCode('0000');

  const result = await ensureHubConnected();
  assert.equal(result.status, 'rejected');
  assert.equal(result.keepTrying, false);
  assert.equal(shouldOpenHubControl({ ...result, controlUrl: `${srv.base}/control` }), false);
});

test('ensureHubConnected keeps retrying when the bus is genuinely offline', async (t) => {
  clearHubSetup();
  saveHubControlUrl('http://localhost:59991/control');
  saveHubPairCode('4821');

  const result = await ensureHubConnected();
  assert.equal(result.keepTrying, true);
  assert.notEqual(result.status, 'rejected');
});
