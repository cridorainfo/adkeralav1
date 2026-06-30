import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  parseInfoText,
  readInfoFile,
  writeInfoFile,
  getDbPaths,
} from '../server/dbApi.js';
import { backupPathFor, tmpPathFor } from '../server/safeFileWrite.js';

const INFO_HEADER = `# AdKerala — routes, stops, settings (JSON below)
# Edit this file in Notepad. Put media files in db/media/ subfolders.
# Use "mediaFile" and "audioFile" for paths like "ads/promo.mp4" (relative to db/media/).
`;

describe('db/info.txt power-loss recovery', () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'adkerala-db-'));
    const { dbDir, mediaDir } = getDbPaths(root);
    await fs.mkdir(path.join(mediaDir, 'ads'), { recursive: true });
    await fs.mkdir(path.join(mediaDir, 'stops'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('recovers from .bak when main file is empty after power loss', async () => {
    const { infoFile } = getDbPaths(root);
    const good = { routes: [], savedAt: 1000, busProfile: { pairingCode: '1234' } };
    await writeInfoFile(root, good);

    await fs.writeFile(infoFile, INFO_HEADER, 'utf8');

    const recovered = await readInfoFile(root);
    assert.equal(recovered.savedAt, 1000);
    assert.equal(recovered.busProfile.pairingCode, '1234');

    const mainRaw = await fs.readFile(infoFile, 'utf8');
    assert.ok(mainRaw.includes('"pairingCode"'));
  });

  it('recovers from .tmp when rename never completed', async () => {
    const { infoFile } = getDbPaths(root);
    const older = { routes: [], savedAt: 500 };
    const newer = { routes: [{ id: 'r1', name: 'A', stops: [] }], savedAt: 2000 };

    await writeInfoFile(root, older);
    await fs.writeFile(tmpPathFor(infoFile), INFO_HEADER + JSON.stringify(newer, null, 2) + '\n', 'utf8');
    await fs.writeFile(infoFile, INFO_HEADER, 'utf8');

    const recovered = await readInfoFile(root);
    assert.equal(recovered.savedAt, 2000);
    assert.equal(recovered.routes[0].id, 'r1');
  });

  it('picks newest valid snapshot when multiple copies exist', async () => {
    const { infoFile } = getDbPaths(root);
    const bakData = { routes: [], savedAt: 100 };
    const mainData = { routes: [], savedAt: 300 };

    await fs.writeFile(backupPathFor(infoFile), INFO_HEADER + JSON.stringify(bakData, null, 2) + '\n', 'utf8');
    await fs.writeFile(infoFile, INFO_HEADER + JSON.stringify(mainData, null, 2) + '\n', 'utf8');

    const recovered = await readInfoFile(root);
    assert.equal(recovered.savedAt, 300);
  });

  it('parseInfoText rejects comment-only files', () => {
    assert.throws(() => parseInfoText(INFO_HEADER), /No JSON object found/);
  });

  it('recovers from external archive when db files are all empty', async () => {
    const { infoFile } = getDbPaths(root);
    const good = {
      routes: [{ id: 'r1', name: 'Route A', stops: [], startStop: { en: 'A' }, endStop: { en: 'B' } }],
      savedAt: 9000,
      busProfile: { plate: 'KL01AB1234', pairingCode: '5678' },
    };
    await writeInfoFile(root, good);

    await fs.writeFile(infoFile, '', 'utf8');
    await fs.writeFile(backupPathFor(infoFile), '', 'utf8');
    await fs.writeFile(tmpPathFor(infoFile), '', 'utf8');

    const recovered = await readInfoFile(root);
    assert.equal(recovered.savedAt, 9000);
    assert.equal(recovered.busProfile.pairingCode, '5678');
    assert.equal(recovered.routes[0].id, 'r1');

    const mainRaw = await fs.readFile(infoFile, 'utf8');
    assert.ok(mainRaw.includes('"pairingCode"'));
  });
});
