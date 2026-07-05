import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { setupDbApi, ensureDbLayout, writeInfoFile } from '../server/dbApi.js';
import { setupDriverAuth } from '../server/driverAuth.js';
import { setupDriveApi } from '../server/driveApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startTestServer(state = {}) {
  const testRoot = path.join(__dirname, `.tmp-driver-connect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  setupDbApi(app, testRoot);
  setupDriverAuth(app, {
    dataRoot: testRoot,
    verifyWithCloud: async () => ({ ok: false }),
    verifyLinkedWithCloud: async () => ({ ok: false }),
  });
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

async function connectPhone(base, code = '4821') {
  const res = await fetch(`${base}/api/driver/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: code }),
  });
  const json = await res.json();
  assert.equal(json.ok, true, json.error ?? `connect failed (${res.status})`);
  return json;
}

test('POST /api/driver/connect accepts pair code without OTP (offline LAN)', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const bad = await fetch(`${srv.base}/api/driver/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '0000' }),
  });
  assert.equal(bad.status, 403);

  const json = await connectPhone(srv.base);
  assert.ok(json.token);
  assert.ok(json.devicesDisconnectAt === null || typeof json.devicesDisconnectAt === 'string');

  const connected = await fetch(`${srv.base}/api/driver/connected`);
  const connectedJson = await connected.json();
  assert.equal(connectedJson.connectedDeviceCount, 1);

  const drive = await fetch(`${srv.base}/api/drive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Driver-Token': json.token,
    },
    body: JSON.stringify({ action: 'endTrip' }),
  });
  assert.equal(drive.status, 200);
});

test('multiple phones connect and one disconnect leaves others active', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const phoneA = await connectPhone(srv.base);
  const phoneB = await connectPhone(srv.base);

  let connected = await fetch(`${srv.base}/api/driver/connected`);
  assert.equal((await connected.json()).connectedDeviceCount, 2);

  await fetch(`${srv.base}/api/driver/disconnect`, {
    method: 'POST',
    headers: { 'X-Driver-Token': phoneA.token },
  });

  connected = await fetch(`${srv.base}/api/driver/connected`);
  assert.equal((await connected.json()).connectedDeviceCount, 1);

  const unlockB = await fetch(`${srv.base}/api/driver/unlock-status`, {
    headers: { 'X-Driver-Token': phoneB.token },
  });
  assert.equal((await unlockB.json()).unlocked, true);

  const unlockA = await fetch(`${srv.base}/api/driver/unlock-status`, {
    headers: { 'X-Driver-Token': phoneA.token },
  });
  assert.equal((await unlockA.json()).unlocked, false);
});

test('POST /api/driver/disconnect clears connectedDeviceCount when last phone leaves', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const { token } = await connectPhone(srv.base);

  await fetch(`${srv.base}/api/driver/disconnect`, {
    method: 'POST',
    headers: { 'X-Driver-Token': token },
  });

  const connected = await fetch(`${srv.base}/api/driver/connected`);
  const json = await connected.json();
  assert.equal(json.connectedDeviceCount, 0);
  assert.equal(json.connected, false);
});

test('POST /api/driver/disconnect-all revokes every phone session and rotates pairing code', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const phoneA = await connectPhone(srv.base);
  const phoneB = await connectPhone(srv.base);

  const res = await fetch(`${srv.base}/api/driver/disconnect-all`, { method: 'POST' });
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.connectedDeviceCount, 0);
  assert.ok(json.devicesDisconnectAt);
  assert.notEqual(json.pairingCode, '4821');

  const unlockA = await fetch(`${srv.base}/api/driver/unlock-status`, {
    headers: { 'X-Driver-Token': phoneA.token },
  });
  const unlockB = await fetch(`${srv.base}/api/driver/unlock-status`, {
    headers: { 'X-Driver-Token': phoneB.token },
  });
  assert.equal((await unlockA.json()).unlocked, false);
  assert.equal((await unlockB.json()).unlocked, false);

  const connected = await fetch(`${srv.base}/api/driver/connected`);
  assert.equal((await connected.json()).connectedDeviceCount, 0);

  const reconnect = await connectPhone(srv.base, json.pairingCode);
  assert.ok(reconnect.token);
});

test('phones can pair again after disconnect-all with new pairing code', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const first = await connectPhone(srv.base);
  const disconnect = await fetch(`${srv.base}/api/driver/disconnect-all`, { method: 'POST' });
  const disconnectJson = await disconnect.json();

  const second = await connectPhone(srv.base, disconnectJson.pairingCode);
  assert.notEqual(first.token, second.token);

  const connected = await fetch(`${srv.base}/api/driver/connected`);
  assert.equal((await connected.json()).connectedDeviceCount, 1);
});
