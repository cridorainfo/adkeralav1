import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { setupDbApi, ensureDbLayout, writeInfoFile } from '../server/dbApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testRoot = path.join(__dirname, '.tmp-server');

async function startTestServer() {
  await fs.rm(testRoot, { recursive: true, force: true });
  await ensureDbLayout(testRoot);
  await writeInfoFile(testRoot, {
    routes: [],
    activeRouteId: null,
    savedAt: Date.now(),
  });

  const app = express();
  app.use(express.json({ limit: '2mb' }));
  setupDbApi(app, testRoot);

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

function readSseUntil(base, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSE timeout')), timeoutMs);
    fetch(`${base}/api/state/events`).then(async (res) => {
      if (!res.ok || !res.body) {
        clearTimeout(timer);
        reject(new Error(`SSE HTTP ${res.status}`));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const msg = JSON.parse(dataLine.slice(6));
          if (predicate(msg)) {
            clearTimeout(timer);
            reader.cancel().catch(() => {});
            resolve(msg);
            return;
          }
        }
      }

      clearTimeout(timer);
      reject(new Error('SSE stream ended before match'));
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test('GET /api/state returns db layout', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const res = await fetch(`${srv.base}/api/state`);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.data?.routes));
});

test('POST /api/state merges and SSE notifies clients', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.close());

  const connected = readSseUntil(srv.base, (msg) => msg.type === 'connected');
  const changed = readSseUntil(srv.base, (msg) => msg.type === 'state-changed');

  await connected;

  const post = await fetch(`${srv.base}/api/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      savedAt: Date.now(),
      routes: [{ id: 'r-test', name: 'Test Route', startStop: { en: 'Start' }, endStop: { en: 'End' }, stops: [] }],
      activeRouteId: 'r-test',
      serialRuntime: { status: 'connected', isConnected: true, lastLine: '1', at: Date.now() },
    }),
  });
  const postJson = await post.json();
  assert.equal(postJson.ok, true);

  await changed;

  const get = await fetch(`${srv.base}/api/state`);
  const getJson = await get.json();
  assert.equal(getJson.data.routes[0].name, 'Test Route');
  assert.equal(getJson.data.serialRuntime.lastLine, '1');
});
