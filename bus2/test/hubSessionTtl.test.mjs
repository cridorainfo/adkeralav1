import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { setupDbApi, ensureDbLayout, writeInfoFile } from '../server/dbApi.js';
import {
  initHubSessions,
  resetHubSessionsForTests,
  setupHubSessions,
  isHubSessionValid,
  setSessionTtlMsForTests,
} from '../server/hubSessions.js';
import { setupDriveApi } from '../server/driveApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startTestServer() {
  resetHubSessionsForTests();
  const testRoot = path.join(
    __dirname,
    `.tmp-hub-ttl-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const { port } = server.address();

  return {
    base: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

// Real HTTP round-trips against the test server take a few hundred ms here (spinning up
// Express + writing/reading db/info.txt each time), so the TTL windows below need generous
// margin around that — a 50ms TTL would already be stale by the time a single pair request's
// response comes back, making the test flaky rather than actually testing expiry.
const TEST_TTL_MS = 2000;

test('isHubSessionValid rejects a session past the TTL (ghost session)', async (t) => {
  const srv = await startTestServer();
  t.after(() => {
    setSessionTtlMsForTests(6 * 60 * 60 * 1000);
    return srv.close();
  });

  setSessionTtlMsForTests(TEST_TTL_MS);

  const res = await fetch(`${srv.base}/api/hub/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '4821', deviceId: 'ghost-phone' }),
  });
  const { token } = await res.json();
  assert.ok(token);

  assert.equal(isHubSessionValid(token), true);

  await new Promise((resolve) => setTimeout(resolve, TEST_TTL_MS + 500));

  assert.equal(isHubSessionValid(token), false);

  // The server-side gate (requireHubAuthUnlessLocal) must honor the same expiry.
  const status = await fetch(`${srv.base}/api/hub/status`, {
    headers: { 'X-Hub-Token': token },
  });
  assert.equal((await status.json()).connected, false);
});

test('a live ping keeps a session valid past what would otherwise be the TTL', async (t) => {
  const srv = await startTestServer();
  t.after(() => {
    setSessionTtlMsForTests(6 * 60 * 60 * 1000);
    return srv.close();
  });

  setSessionTtlMsForTests(TEST_TTL_MS);

  const pairRes = await fetch(`${srv.base}/api/hub/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '4821', deviceId: 'active-phone' }),
  });
  const { token } = await pairRes.json();

  await new Promise((resolve) => setTimeout(resolve, TEST_TTL_MS * 0.6));
  // Ping refreshes lastSeenAt — session should not be expired even once total elapsed time
  // since the original pair exceeds the TTL, as long as it stays within the TTL of the ping.
  await fetch(`${srv.base}/api/hub/ping`, { method: 'POST', headers: { 'X-Hub-Token': token } });
  await new Promise((resolve) => setTimeout(resolve, TEST_TTL_MS * 0.6));

  assert.equal(isHubSessionValid(token), true);
});
