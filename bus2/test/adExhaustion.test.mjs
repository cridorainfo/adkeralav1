import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

test('stampExhaustion: money-budget, weekly hard cap, both together, and house-ad passthrough', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adkerala-ad-exhaustion-'));
  const script = path.join(__dirname, 'adExhaustion.isolated.mjs');
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
