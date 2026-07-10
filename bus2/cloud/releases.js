import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { usePostgres } from './db/pool.js';
import { pgGetPlatformSetting, pgSetPlatformSetting } from './storePg.js';
import { loadStore, saveStore, listBuses } from './store.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cloudPkg = require('./package.json');

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

async function loadReleaseStore() {
  if (usePostgres()) {
    return { ...(await pgGetPlatformSetting('releases', defaultReleaseConfig())) };
  }
  const store = await loadStore();
  return { ...defaultReleaseConfig(), ...(store.releases ?? {}) };
}

async function saveReleaseStore(releases) {
  if (usePostgres()) {
    await pgSetPlatformSetting('releases', releases);
    return;
  }
  const store = await loadStore();
  store.releases = releases;
  await saveStore();
}

export async function getReleaseConfig() {
  return loadReleaseStore();
}

export async function setPcRelease(release) {
  const releases = await loadReleaseStore();
  const incomingVersion = String(release.version ?? '').trim();
  // Release workflows for different tags can finish out of order (retries,
  // re-runs, or two versions shipped close together) — never let a build that
  // completes later regress the fleet's "latest" pointer to an older version.
  if (releases.pc?.version && compareSemver(incomingVersion, releases.pc.version) < 0) {
    return releases.pc;
  }
  releases.pc = {
    version: incomingVersion,
    downloadUrl: String(release.downloadUrl ?? '').trim(),
    sha512: String(release.sha512 ?? '').trim(),
    size: Number(release.size ?? 0) || null,
    releaseNotes: String(release.releaseNotes ?? '').trim(),
    publishedAt: Date.now(),
  };
  await saveReleaseStore(releases);
  return releases.pc;
}

export async function setDriverRelease(release) {
  const releases = await loadReleaseStore();
  const incomingVersion = String(release.version ?? '').trim();
  if (releases.driver?.version && compareSemver(incomingVersion, releases.driver.version) < 0) {
    return releases.driver;
  }
  releases.driver = {
    version: incomingVersion,
    downloadUrl: String(release.downloadUrl ?? '').trim(),
    releaseNotes: String(release.releaseNotes ?? '').trim(),
    publishedAt: Date.now(),
  };
  await saveReleaseStore(releases);
  return releases.driver;
}

export async function setMinVersions({ minPcVersion, minDriverVersion }) {
  const releases = await loadReleaseStore();
  if (minPcVersion != null) releases.minPcVersion = String(minPcVersion).trim();
  if (minDriverVersion != null) releases.minDriverVersion = String(minDriverVersion).trim();
  await saveReleaseStore(releases);
  return releases;
}

export function buildPcLatestYml(pcRelease) {
  if (!pcRelease?.version || !pcRelease?.downloadUrl) {
    return null;
  }

  const fileUrl = pcRelease.downloadUrl;
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

const ONLINE_MS = Number(process.env.ADKERALA_ONLINE_MS ?? 20000);

export async function getFleetVersions() {
  const config = await getReleaseConfig();
  const buses = await listBuses();
  const latestPc = config.pc?.version ?? null;
  const latestDriver = config.driver?.version ?? null;
  const busIds = new Set(buses.map((b) => b.busId));

  return {
    cloudVersion: CLOUD_VERSION,
    latestPc,
    latestDriver,
    minPcVersion: config.minPcVersion,
    minDriverVersion: config.minDriverVersion,
    buses: buses.map(({ busId, updatedAt, telemetry, profile }) => {
      const appVersion = telemetry?.appVersion ?? null;
      const online = Date.now() - updatedAt < ONLINE_MS;
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
        displayName: profile?.displayName ?? null,
        plateDisplay: profile?.plateDisplay ?? telemetry?.plateDisplay ?? null,
      };
    }),
    drivers: await getDriverFleetVersions(config, busIds),
  };
}

async function getDriverFleetVersions(config, busIds) {
  if (usePostgres()) {
    const { query } = await import('./db/pool.js');
    const { rows } = await query(
      `SELECT driver_id, linked_bus_id, app_version, last_seen_at FROM drivers WHERE app_version IS NOT NULL`
    );
    return rows.map((row) => ({
      driverId: row.driver_id,
      linkedBusId: row.linked_bus_id,
      appVersion: row.app_version,
      lastSeenAt: row.last_seen_at ? Number(row.last_seen_at) : null,
      status: driverVersionStatus(row.app_version, config),
      orphaned: !row.linked_bus_id || !busIds.has(row.linked_bus_id),
    }));
  }
  const store = await loadStore();
  return Object.entries(store.drivers ?? {}).map(([driverId, d]) => ({
    driverId,
    linkedBusId: d.linkedBusId,
    appVersion: d.appVersion ?? null,
    lastSeenAt: d.lastSeenAt ?? null,
    status: driverVersionStatus(d.appVersion, config),
    orphaned: !d.linkedBusId || !busIds.has(d.linkedBusId),
  }));
}

function driverVersionStatus(appVersion, config) {
  if (!appVersion) return 'unknown';
  if (config.minDriverVersion && compareSemver(appVersion, config.minDriverVersion) < 0) {
    return 'below-minimum';
  }
  if (config.driver?.version && compareSemver(appVersion, config.driver.version) < 0) {
    return 'outdated';
  }
  return 'current';
}
