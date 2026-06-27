import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadStore, saveStore, listBuses } from './store.js';

const require = createRequire(import.meta.url);
const cloudPkg = require('./package.json');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CLOUD_VERSION = cloudPkg.version;

export function compareSemver(a, b) {
  const pa = String(a ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  const pb = String(b ?? '0.0.0').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function defaultReleaseConfig() {
  return {
    pc: null,
    driver: null,
    minPcVersion: '0.1.0',
    minDriverVersion: '0.1.0',
  };
}

export async function getReleaseConfig() {
  const store = await loadStore();
  return { ...defaultReleaseConfig(), ...(store.releases ?? {}) };
}

export async function setPcRelease(release) {
  const store = await loadStore();
  store.releases = { ...defaultReleaseConfig(), ...(store.releases ?? {}) };
  store.releases.pc = {
    version: String(release.version ?? '').trim(),
    downloadUrl: String(release.downloadUrl ?? '').trim(),
    sha512: String(release.sha512 ?? '').trim(),
    size: Number(release.size ?? 0) || null,
    releaseNotes: String(release.releaseNotes ?? '').trim(),
    publishedAt: Date.now(),
  };
  await saveStore();
  return store.releases.pc;
}

export async function setDriverRelease(release) {
  const store = await loadStore();
  store.releases = { ...defaultReleaseConfig(), ...(store.releases ?? {}) };
  store.releases.driver = {
    version: String(release.version ?? '').trim(),
    downloadUrl: String(release.downloadUrl ?? '').trim(),
    releaseNotes: String(release.releaseNotes ?? '').trim(),
    publishedAt: Date.now(),
  };
  await saveStore();
  return store.releases.driver;
}

export async function setMinVersions({ minPcVersion, minDriverVersion }) {
  const store = await loadStore();
  store.releases = { ...defaultReleaseConfig(), ...(store.releases ?? {}) };
  if (minPcVersion != null) store.releases.minPcVersion = String(minPcVersion).trim();
  if (minDriverVersion != null) store.releases.minDriverVersion = String(minDriverVersion).trim();
  await saveStore();
  return store.releases;
}

export function buildPcLatestYml(pcRelease) {
  if (!pcRelease?.version || !pcRelease?.downloadUrl) {
    return null;
  }

  const fileUrl = pcRelease.downloadUrl;
  const filename = path.basename(fileUrl.split('?')[0]) || `AdKeralaDisplay-Setup-${pcRelease.version}.exe`;
  const releaseDate = new Date(pcRelease.publishedAt ?? Date.now()).toISOString();
  const lines = [
    `version: ${pcRelease.version}`,
    'files:',
    `  - url: ${fileUrl}`,
  ];

  if (pcRelease.sha512) {
    lines.push(`    sha512: ${pcRelease.sha512}`);
  }
  if (pcRelease.size) {
    lines.push(`    size: ${pcRelease.size}`);
  }

  lines.push(`path: ${fileUrl}`);
  if (pcRelease.sha512) {
    lines.push(`sha512: ${pcRelease.sha512}`);
  }
  lines.push(`releaseDate: '${releaseDate}'`);
  return lines.join('\n');
}

export async function getFleetVersions() {
  const config = await getReleaseConfig();
  const buses = await listBuses();
  const latestPc = config.pc?.version ?? null;
  const latestDriver = config.driver?.version ?? null;

  return {
    cloudVersion: CLOUD_VERSION,
    latestPc,
    latestDriver,
    minPcVersion: config.minPcVersion,
    minDriverVersion: config.minDriverVersion,
    buses: buses.map(({ busId, updatedAt, telemetry }) => {
      const appVersion = telemetry?.appVersion ?? null;
      const online = Date.now() - updatedAt < 15000;
      let pcStatus = 'unknown';
      if (appVersion && latestPc) {
        pcStatus = compareSemver(appVersion, latestPc) >= 0 ? 'current' : 'outdated';
      } else if (appVersion) {
        pcStatus = 'reporting';
      }
      if (appVersion && config.minPcVersion && compareSemver(appVersion, config.minPcVersion) < 0) {
        pcStatus = 'below-minimum';
      }
      return {
        busId,
        online,
        updatedAt,
        appVersion,
        pcStatus,
        plateDisplay: telemetry?.plateDisplay ?? null,
      };
    }),
  };
}
