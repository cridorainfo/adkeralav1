import fs from 'fs';
import path from 'path';
import { randomUUID, randomInt } from 'crypto';
import { getDataRoot } from './getAppRoot.js';

const CONFIG_FILENAME = 'adkerala.device.json';

function configPath(dataRoot) {
  return path.join(dataRoot ?? getDataRoot(), CONFIG_FILENAME);
}

function defaultCloudUrl() {
  return (
    process.env.ADKERALA_CLOUD_URL ??
    process.env.VITE_CLOUD_URL ??
    ''
  ).replace(/\/+$/, '');
}

export function generateFleetClaimCode() {
  return String(randomInt(100000, 999999));
}

function readRaw(dataRoot) {
  const file = configPath(dataRoot);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeRaw(dataRoot, config) {
  const file = configPath(dataRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf8');
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
