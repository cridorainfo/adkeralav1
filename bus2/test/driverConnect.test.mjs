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
const testRoot = path.join(__dirname, '.tmp-driver-connect');

async function startTestServer(state = {}) {
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
  const { port } = server.address();

  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
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

  const res = await fetch(`${srv.base}/api/driver/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '4821' }),
  });
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(json.token);

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

test('POST /api/driver/disconnect clears connectedDeviceCount', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const connect = await fetch(`${srv.base}/api/driver/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: '4821' }),
  });
  const { token } = await connect.json();

  await fetch(`${srv.base}/api/driver/disconnect`, {
    method: 'POST',
    headers: { 'X-Driver-Token': token },
  });

  const connected = await fetch(`${srv.base}/api/driver/connected`);
  const json = await connected.json();
  assert.equal(json.connectedDeviceCount, 0);
  assert.equal(json.connected, false);
});
