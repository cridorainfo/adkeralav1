import fs from 'fs';
import path from 'path';
import { randomUUID, randomInt } from 'crypto';
import { getDataRoot } from './getAppRoot.js';
import { resolveCloudUrl } from '../shared/cloudUrls.js';
import { backupPathFor, tmpPathFor } from './safeFileWrite.js';
import { STATE_ARCHIVE_DIR } from './stateArchive.js';

const CONFIG_FILENAME = 'adkerala.device.json';

function configPath(dataRoot) {
  return path.join(dataRoot ?? getDataRoot(), CONFIG_FILENAME);
}

function deviceArchivePath(dataRoot) {
  return path.join(dataRoot ?? getDataRoot(), STATE_ARCHIVE_DIR, 'device', 'latest.json');
}

function defaultCloudUrl() {
  return resolveCloudUrl(process.env);
}

export function generateFleetClaimCode() {
  return String(randomInt(100000, 999999));
}

function isValidDeviceJson(raw) {
  try {
    const json = JSON.parse(raw);
    return json && typeof json === 'object' && json.installId;
  } catch {
    return false;
  }
}

function readRaw(dataRoot) {
  const file = configPath(dataRoot);
  const candidates = [file, tmpPathFor(file), backupPathFor(file), deviceArchivePath(dataRoot)];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const raw = fs.readFileSync(candidate, 'utf8');
      if (!isValidDeviceJson(raw)) continue;
      const parsed = JSON.parse(raw);
      if (candidate !== file) {
        console.warn(
          `AdKerala: recovered ${CONFIG_FILENAME} from ${path.relative(dataRoot, candidate) || path.basename(candidate)} after unexpected shutdown`
        );
        writeRaw(dataRoot, parsed, { skipArchive: true });
      }
      return parsed;
    } catch {
      /* try next snapshot */
    }
  }
  return null;
}

function writeRaw(dataRoot, config, { skipArchive = false } = {}) {
  const file = configPath(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = JSON.stringify(config, null, 2);

  if (!skipArchive) {
    const archiveFile = deviceArchivePath(dataRoot);
    fs.mkdirSync(path.dirname(archiveFile), { recursive: true });
    const archiveTmp = `${archiveFile}.tmp`;
    fs.writeFileSync(archiveTmp, content, 'utf8');
    try {
      fs.renameSync(archiveTmp, archiveFile);
    } catch {
      fs.copyFileSync(archiveTmp, archiveFile);
      fs.unlinkSync(archiveTmp);
    }
  }

  if (fs.existsSync(file)) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, backupPathFor(file));
    } catch {
      /* skip backup when current file is corrupt */
    }
  }

  const tmp = tmpPathFor(file);
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.copyFileSync(tmp, file);
    fs.unlinkSync(tmp);
  }
  try {
    fs.copyFileSync(file, backupPathFor(file));
  } catch {
    /* ignore */
  }
}

/** Load or create device config on first boot. */
export function loadDeviceConfig(dataRoot) {
  let config = readRaw(dataRoot);
  if (!config) {
    config = {
      installId: randomUUID(),
      fleetClaimCode: generateFleetClaimCode(),
      busId: null,
      deviceToken: null,
      cloudUrl: defaultCloudUrl(),
      claimedAt: null,
      createdAt: Date.now(),
    };
    writeRaw(dataRoot, config);
  }
  if (!config.cloudUrl && defaultCloudUrl()) {
    config.cloudUrl = defaultCloudUrl();
    writeRaw(dataRoot, config);
  }
  return config;
}

export function saveDeviceConfig(dataRoot, patch) {
  const current = loadDeviceConfig(dataRoot);
  const next = { ...current, ...patch };
  writeRaw(dataRoot, next);
  return next;
}

export function isDeviceClaimed(dataRoot) {
  const config = loadDeviceConfig(dataRoot);
  return Boolean(config.busId && config.deviceToken);
}

export function getDeviceCredentials(dataRoot) {
  const config = loadDeviceConfig(dataRoot);
  const envBusId = process.env.ADKERALA_BUS_ID;
  const envCloud = defaultCloudUrl();

  if (config.busId && config.deviceToken) {
    return {
      cloudUrl: config.cloudUrl || envCloud,
      busId: config.busId,
      deviceToken: config.deviceToken,
      installId: config.installId,
      fleetClaimCode: config.fleetClaimCode,
      claimed: true,
    };
  }

  return {
    cloudUrl: config.cloudUrl || envCloud,
    busId: envBusId ?? null,
    deviceToken: null,
    installId: config.installId,
    fleetClaimCode: config.fleetClaimCode,
    claimed: Boolean(envBusId && !config.installId),
  };
}

export function applyClaimCredentials(dataRoot, { busId, deviceToken, cloudUrl }) {
  return saveDeviceConfig(dataRoot, {
    busId,
    deviceToken,
    cloudUrl: (cloudUrl ?? defaultCloudUrl()).replace(/\/+$/, ''),
    claimedAt: Date.now(),
  });
}

/** Drop fleet claim after bus removed/revoked on cloud — PC shows claim code again. */
export function clearDeviceClaim(dataRoot) {
  const current = loadDeviceConfig(dataRoot);
  return saveDeviceConfig(dataRoot, {
    busId: null,
    deviceToken: null,
    claimedAt: null,
    // Keep installId + fleetClaimCode so server enrollment stays in sync.
    installId: current.installId,
    fleetClaimCode: current.fleetClaimCode,
  });
}
