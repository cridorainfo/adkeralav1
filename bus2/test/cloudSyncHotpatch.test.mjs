import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { syncServerHotpatchFromCloud } from '../server/cloudSync.js';

async function makeTempDataRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'adkerala-hotpatch-sync-'));
}

/** Fake cloud that serves /api/releases/pc/hotpatch/latest and the zip bytes themselves. */
function startFakeCloud({ release, zipBytes }) {
  let hotpatchLatestHits = 0;
  let zipDownloadHits = 0;

  const server = http.createServer((req, res) => {
    if (req.url === '/api/releases/pc/hotpatch/latest') {
      hotpatchLatestHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, release }));
      return;
    }
    if (req.url === '/zip') {
      zipDownloadHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(zipBytes);
      return;
    }
    res.writeHead(404).end();
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        server,
        cloudUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
        get hotpatchLatestHits() {
          return hotpatchLatestHits;
        },
        get zipDownloadHits() {
          return zipDownloadHits;
        },
      });
    });
  });
}

async function writeLocalHotpatchState(dataRoot, { current, failures } = {}) {
  const dir = path.join(dataRoot, 'hotpatch');
  await fs.mkdir(dir, { recursive: true });
  if (current) {
    await fs.writeFile(path.join(dir, 'current.json'), JSON.stringify({ version: current }));
  }
  if (failures) {
    await fs.writeFile(path.join(dir, 'failures.json'), JSON.stringify(failures));
  }
}

async function freePort() {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
}

test('syncServerHotpatchFromCloud: downloads and checksum-verifies a newer, never-tried version', async () => {
  const dataRoot = await makeTempDataRoot();
  const zipBytes = Buffer.from('fake-zip-bytes-for-1.0.16');
  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');

  const port = await freePort();
  const cloud = await startFakeCloudWithSelfReferencingRelease(port, zipBytes, sha256);

  const creds = { cloudUrl: cloud.cloudUrl, busId: 'bus-1', deviceToken: 'tok' };
  await syncServerHotpatchFromCloud(dataRoot, creds);

  const zipPath = path.join(dataRoot, 'hotpatch', 'incoming', '1.0.16.zip');
  const savedBytes = await fs.readFile(zipPath);
  assert.ok(savedBytes.equals(zipBytes), 'downloaded bundle bytes should match');
  assert.equal(cloud.zipDownloadHits, 1);

  await cloud.close();
});

/** Helper: a fake cloud whose /latest response points back at its own /zip endpoint. */
function startFakeCloudWithSelfReferencingRelease(fixedPort, zipBytes, sha256) {
  let zipDownloadHits = 0;
  let latestHits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/api/releases/pc/hotpatch/latest') {
      latestHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          release: { version: '1.0.16', downloadUrl: `http://127.0.0.1:${fixedPort}/zip`, sha256 },
        })
      );
      return;
    }
    if (req.url === '/zip') {
      zipDownloadHits += 1;
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(zipBytes);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => {
    server.listen(fixedPort, '127.0.0.1', () => {
      resolve({
        cloudUrl: `http://127.0.0.1:${fixedPort}`,
        close: () => new Promise((r) => server.close(r)),
        get zipDownloadHits() {
          return zipDownloadHits;
        },
        get latestHits() {
          return latestHits;
        },
      });
    });
  });
}

test('syncServerHotpatchFromCloud: skips when the reported version is already active', async () => {
  const dataRoot = await makeTempDataRoot();
  await writeLocalHotpatchState(dataRoot, { current: '1.0.16' });

  const zipBytes = Buffer.from('irrelevant');
  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const cloud = await startFakeCloud({
    release: { version: '1.0.16', downloadUrl: 'http://127.0.0.1:1/zip', sha256 },
    zipBytes,
  });

  await syncServerHotpatchFromCloud(dataRoot, { cloudUrl: cloud.cloudUrl, busId: 'b', deviceToken: 't' });

  assert.equal(cloud.zipDownloadHits, 0, 'must not attempt to download an already-active version');
  await cloud.close();
});

test('syncServerHotpatchFromCloud: skips a version that already hit the failure cap', async () => {
  const dataRoot = await makeTempDataRoot();
  await writeLocalHotpatchState(dataRoot, { failures: { '1.0.16': 2 } });

  const zipBytes = Buffer.from('irrelevant');
  const sha256 = crypto.createHash('sha256').update(zipBytes).digest('hex');
  const cloud = await startFakeCloud({
    release: { version: '1.0.16', downloadUrl: 'http://127.0.0.1:1/zip', sha256 },
    zipBytes,
  });

  await syncServerHotpatchFromCloud(dataRoot, { cloudUrl: cloud.cloudUrl, busId: 'b', deviceToken: 't' });

  assert.equal(cloud.zipDownloadHits, 0, 'must give up on a version that already exhausted its retries');
  await cloud.close();
});

test('syncServerHotpatchFromCloud: a checksum mismatch is caught, not thrown, and leaves no file behind', async () => {
  const dataRoot = await makeTempDataRoot();
  const zipBytes = Buffer.from('tampered-in-transit');
  const wrongSha = 'f'.repeat(64);

  const port = await freePort();
  const cloud = await startFakeCloudWithSelfReferencingRelease(port, zipBytes, wrongSha);

  await assert.doesNotReject(() =>
    syncServerHotpatchFromCloud(dataRoot, { cloudUrl: cloud.cloudUrl, busId: 'b', deviceToken: 't' })
  );

  const incomingDir = path.join(dataRoot, 'hotpatch', 'incoming');
  const files = await fs.readdir(incomingDir).catch(() => []);
  assert.deepEqual(files, [], 'a checksum-failed download must not leave a trusted file behind');

  await cloud.close();
});
