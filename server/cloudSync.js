import { readInfoFile, writeInfoFile } from './dbApi.js';
import { applyCloudCommands, buildDisplaySnapshot } from './cloudCommands.js';
import { getStopInfo } from '../src/store/busStore.js';

const CLOUD_URL = (process.env.ADKERALA_CLOUD_URL ?? '').replace(/\/+$/, '');
const BUS_ID = process.env.ADKERALA_BUS_ID ?? 'bus-1';
const BUS_KEY = process.env.ADKERALA_BUS_KEY ?? '';
const SYNC_INTERVAL_MS = Number(process.env.ADKERALA_CLOUD_INTERVAL_MS ?? 5000);

let lastPushedAt = 0;

async function cloudFetch(path, options = {}) {
  if (!CLOUD_URL) return null;
  const headers = {
    'Content-Type': 'application/json',
    ...(BUS_KEY ? { 'X-Bus-Key': BUS_KEY } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${CLOUD_URL}${path}`, { ...options, headers });
  return res.json().catch(() => null);
}

function buildTelemetry(state) {
  const stopInfo = getStopInfo(state);
  const current = stopInfo.atTripStart ? stopInfo.start : stopInfo.current;
  const upcoming = stopInfo.allStops?.[state.currentStopIndex + 1] ?? stopInfo.final;

  return {
    busId: BUS_ID,
    savedAt: state.savedAt ?? Date.now(),
    activeRouteId: state.activeRouteId ?? null,
    routeName: stopInfo.routeName ?? null,
    currentStopIndex: state.currentStopIndex ?? 0,
    currentStopEn: current?.en ?? null,
    currentStopMl: current?.ml ?? null,
    nextStopEn: upcoming?.en ?? null,
    nextStopMl: upcoming?.ml ?? null,
    tripDeparted: Boolean(state.tripDeparted),
    routeDirection: state.routeDirection ?? 'forward',
    displayView: state.displayView ?? 'route',
    adsCount: (state.ads ?? []).length,
    bannerAdsCount: (state.bannerAds ?? []).length,
    announcementRequest: state.announcementRequest ?? null,
    driverLocation: state.driverLocation ?? null,
  };
}

/** Push bus telemetry + pull per-bus command queue when cloud URL is configured. */
export async function runCloudSync(root) {
  if (!CLOUD_URL) return;

  const state = await readInfoFile(root);
  if (!state) return;

  const telemetry = buildTelemetry(state);
  const displaySnapshot = buildDisplaySnapshot(state);

  await cloudFetch(`/api/buses/${encodeURIComponent(BUS_ID)}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ telemetry, state, displaySnapshot }),
  });

  const pending = await cloudFetch(`/api/buses/${encodeURIComponent(BUS_ID)}/commands`);
  if (pending?.ok && Array.isArray(pending.commands) && pending.commands.length) {
    const current = (await readInfoFile(root)) ?? {};
    const merged = applyCloudCommands(current, pending.commands);
    await writeInfoFile(root, merged);

    for (const cmd of pending.commands) {
      await cloudFetch(
        `/api/buses/${encodeURIComponent(BUS_ID)}/commands/${encodeURIComponent(cmd.id)}/ack`,
        { method: 'POST', body: '{}' }
      );
    }
  }

  lastPushedAt = Date.now();
}

export function startCloudSyncLoop(root) {
  if (!CLOUD_URL) {
    console.log('  Cloud:   (disabled — set ADKERALA_CLOUD_URL to enable admin dashboard sync)\n');
    return () => {};
  }

  console.log(`  Cloud:   ${CLOUD_URL}  (bus ${BUS_ID})\n`);

  const tick = () => {
    runCloudSync(root).catch((err) => {
      if (Date.now() - lastPushedAt > 60000) {
        console.warn('AdKerala cloud sync:', err.message);
      }
    });
  };

  tick();
  const id = setInterval(tick, SYNC_INTERVAL_MS);
  return () => clearInterval(id);
}

export function getCloudConfig() {
  return { cloudUrl: CLOUD_URL, busId: BUS_ID, enabled: Boolean(CLOUD_URL) };
}
