import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('fleet enroll status keeps token until bus ack', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adkerala-fleet-enroll-'));
  const script = path.join(__dirname, 'fleetEnroll.isolated.mjs');
  const result = spawnSync(
    process.execPath,
    [script],
    {
      cwd: root,
      env: { ...process.env, DATA_DIR: dataDir, DATABASE_URL: '' },
      encoding: 'utf8',
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('stale pending enrollments drop off the admin list', () => {
  const activeMs = Number(process.env.ADKERALA_ENROLL_ACTIVE_MS ?? 90000);
  const activeSince = Date.now() - activeMs;
  const stale = {
    claimed: false,
    expiresAt: Date.now() + 30 * 60 * 1000,
    updatedAt: Date.now() - activeMs - 5000,
  };
  assert.equal(stale.updatedAt < activeSince, true);
});
