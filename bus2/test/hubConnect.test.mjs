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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startTestServer(state = {}) {
  resetHubSessionsForTests();
  const testRoot = path.join(__dirname, `.tmp-hub-connect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.rm(testRoot, { recursive: true, force: true });
  await ensureDbLayout(testRoot);
  await writeInfoFile(testRoot, {
    routes: [],
    activeRouteId: null,
    savedAt: Date.now(),
    busProfile: { plate: 'KL01AB1234', plateDisplay: 'KL 01 AB 1234', pairingCode: '4821' },
    connectedDeviceCount: 0,
    ...state,
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
    testRoot,
    close: async () => {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function pairPhone(base, code = '4821', deviceId = 'phone-test-1') {
  const res = await fetch(`${base}/api/hub/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code, deviceId }),
  });
  const json = await res.json();
  assert.equal(json.ok, true, json.error ?? `pair failed (${res.status})`);
  return json;
}

test('POST /api/hub/pair accepts pair code on LAN', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const bad = await fetch(`${srv.base}/api/hub/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '0000', deviceId: 'x' }),
  });
  assert.equal(bad.status, 403);

  const json = await pairPhone(srv.base);
  assert.ok(json.token);

  const connected = await fetch(`${srv.base}/api/hub/devices`);
  assert.equal((await connected.json()).connectedDeviceCount, 1);

  const drive = await fetch(`${srv.base}/api/drive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Token': json.token,
    },
    body: JSON.stringify({ action: 'endTrip' }),
  });
  assert.equal(drive.status, 200);
});

test('idempotent pair reuses token for same deviceId', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const first = await pairPhone(srv.base, '4821', 'device-abc');
  const second = await pairPhone(srv.base, '4821', 'device-abc');
  assert.equal(first.token, second.token);
  assert.equal(second.reused, true);

  const connected = await fetch(`${srv.base}/api/hub/devices`);
  assert.equal((await connected.json()).connectedDeviceCount, 1);
});

test('multiple devices connect and one disconnect leaves others active', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const phoneA = await pairPhone(srv.base, '4821', 'dev-a');
  const phoneB = await pairPhone(srv.base, '4821', 'dev-b');

  let connected = await fetch(`${srv.base}/api/hub/devices`);
  assert.equal((await connected.json()).connectedDeviceCount, 2);

  await fetch(`${srv.base}/api/hub/disconnect`, {
    method: 'POST',
    headers: { 'X-Hub-Token': phoneA.token },
  });

  connected = await fetch(`${srv.base}/api/hub/devices`);
  assert.equal((await connected.json()).connectedDeviceCount, 1);

  const statusB = await fetch(`${srv.base}/api/hub/status`, {
    headers: { 'X-Hub-Token': phoneB.token },
  });
  assert.equal((await statusB.json()).connected, true);

  const statusA = await fetch(`${srv.base}/api/hub/status`, {
    headers: { 'X-Hub-Token': phoneA.token },
  });
  assert.equal((await statusA.json()).connected, false);
});

test('POST /api/hub/disconnect-all revokes every session and rotates pairing code', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const phoneA = await pairPhone(srv.base, '4821', 'dev-a');
  const phoneB = await pairPhone(srv.base, '4821', 'dev-b');

  const res = await fetch(`${srv.base}/api/hub/disconnect-all`, { method: 'POST' });
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.connectedDeviceCount, 0);
  assert.ok(json.devicesDisconnectAt);
  assert.notEqual(json.pairingCode, '4821');

  const statusA = await fetch(`${srv.base}/api/hub/status`, {
    headers: { 'X-Hub-Token': phoneA.token },
  });
  assert.equal((await statusA.json()).connected, false);

  const reconnect = await pairPhone(srv.base, json.pairingCode, 'dev-a');
  assert.ok(reconnect.token);
});
