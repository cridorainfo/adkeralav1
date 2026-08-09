import {
  getSchedulesCatalog,
  saveSchedulesCatalog,
  getCampaignsCatalog,
  saveCampaignsCatalog,
  getPricingSettings,
  setPricingSettings,
  getHouseAds,
  setHouseAds,
  getStopVoiceAdsCatalog,
  setStopVoiceAdsCatalog,
  getGlobalPhraseAudio,
  setGlobalPhraseAudio,
  getStopAudioCatalog,
  mergeStopAudioCatalog,
  listAllRoutes,
  upsertRouteCatalog,
  listBuses,
  getBusProfile,
  upsertBusProfile,
  getBusAdsCatalog,
  setBusAdsCatalog,
  getBusScheduleCatalog,
  setBusScheduleCatalog,
  getBusDisplaySettingsCatalog,
  setBusDisplaySettingsCatalog,
} from './store.js';
import { exportUsersForBackup, restoreUsersFromBackup } from './users.js';

/**
 * Full-platform config/content backup — everything an admin authored through the dashboard
 * (routes, schedules, campaigns/ads, pricing, house ads, stop voice ads, announcement audio, bus
 * profiles + their per-bus pushed catalogs, and login accounts) bundled into one JSON payload
 * that a fresh/empty deployment can self-populate from. See cloud/backupCrypto.js for how the
 * downloaded file itself is protected.
 *
 * Deliberately NOT included:
 *  - Bus device tokens / fleet-claim credentials (cloud/fleet.js, cloud/fleetPg.js). Bulk
 *    exporting live auth secrets for potentially a thousand devices is a meaningfully bigger
 *    security surface than the config data here, and needs its own dedicated design rather than
 *    being bolted onto this pass — a restored bus instead falls back to its existing "boot &
 *    claim" onboarding flow (scan/enter its 6-digit code again), which is already the fast,
 *    designed-for-this path, not a rebuild.
 *  - Ad play history / telemetry / driver GPS history — operational logs that naturally
 *    regenerate going forward and aren't needed for the platform to function; including years of
 *    play events would also bloat the backup enormously at fleet scale for no functional benefit.
 *  - Media files themselves (images/videos on the Railway volume). This backs up the *references*
 *    to them (mediaFile paths embedded in ads/schedules/etc.), not the binary content — the
 *    volume itself needs its own backup mechanism (e.g. the hosting platform's volume snapshots).
 */

export const BACKUP_SCHEMA_VERSION = 1;

export async function buildBackupPayload() {
  const [
    schedules,
    campaigns,
    pricing,
    houseAds,
    stopVoiceAds,
    phraseAudio,
    stopAudio,
    routes,
    buses,
    users,
  ] = await Promise.all([
    getSchedulesCatalog(),
    getCampaignsCatalog(),
    getPricingSettings(),
    getHouseAds(),
    getStopVoiceAdsCatalog(),
    getGlobalPhraseAudio(),
    getStopAudioCatalog(),
    listAllRoutes(),
    listBuses({}),
    exportUsersForBackup(),
  ]);

  const busEntries = await Promise.all(
    (buses ?? []).map(async (b) => {
      const [profile, ads, schedule, displaySettings] = await Promise.all([
        getBusProfile(b.busId),
        getBusAdsCatalog(b.busId),
        getBusScheduleCatalog(b.busId),
        getBusDisplaySettingsCatalog(b.busId),
      ]);
      return { busId: b.busId, profile, ads, schedule, displaySettings };
    })
  );

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    schedules,
    campaigns,
    pricing,
    houseAds,
    stopVoiceAds: stopVoiceAds?.stopVoiceAds ?? {},
    phraseAudio: phraseAudio?.audioFragments ?? {},
    stopAudio: stopAudio?.stopAudio ?? {},
    routes: routes ?? [],
    buses: busEntries,
    users,
  };
}

/** Restores a decrypted backup payload — best-effort per category (one category failing doesn't
 * abort the rest) so a partially-relevant backup (e.g. hand-edited, or from a slightly different
 * schema draft) still restores whatever it can, with the summary reporting what actually landed. */
export async function restoreBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup payload');
  }
  if (payload.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported backup schema version ${payload.schemaVersion} (this server restores version ${BACKUP_SCHEMA_VERSION})`
    );
  }

  const summary = {};
  const errors = [];

  async function step(name, fn) {
    try {
      summary[name] = await fn();
    } catch (err) {
      errors.push(`${name}: ${err.message ?? err}`);
    }
  }

  if (payload.schedules) {
    await step('schedules', async () => {
      await saveSchedulesCatalog(payload.schedules);
      return Object.keys(payload.schedules).length;
    });
  }
  if (payload.campaigns) {
    await step('campaigns', async () => {
      await saveCampaignsCatalog(payload.campaigns);
      return Object.keys(payload.campaigns).length;
    });
  }
  if (payload.pricing) {
    await step('pricing', () => setPricingSettings(payload.pricing));
  }
  if (payload.houseAds) {
    await step('houseAds', () => setHouseAds(payload.houseAds));
  }
  if (payload.stopVoiceAds) {
    await step('stopVoiceAds', async () => {
      await setStopVoiceAdsCatalog(payload.stopVoiceAds);
      return Object.keys(payload.stopVoiceAds).length;
    });
  }
  if (payload.phraseAudio) {
    await step('phraseAudio', () => setGlobalPhraseAudio(payload.phraseAudio));
  }
  if (payload.stopAudio) {
    await step('stopAudio', () => mergeStopAudioCatalog(payload.stopAudio));
  }
  if (Array.isArray(payload.routes)) {
    await step('routes', async () => {
      for (const route of payload.routes) {
        if (route?.id) await upsertRouteCatalog(route);
      }
      return payload.routes.length;
    });
  }
  if (Array.isArray(payload.buses)) {
    await step('buses', async () => {
      let count = 0;
      for (const entry of payload.buses) {
        if (!entry?.busId) continue;
        if (entry.profile) await upsertBusProfile(entry.busId, entry.profile);
        if (entry.ads) await setBusAdsCatalog(entry.busId, entry.ads);
        if (entry.schedule) await setBusScheduleCatalog(entry.busId, entry.schedule);
        if (entry.displaySettings) {
          const { settingsSavedAt, source, savedAt: _savedAt, ...patch } = entry.displaySettings;
          await setBusDisplaySettingsCatalog(entry.busId, patch, { settingsSavedAt, source });
        }
        count++;
      }
      return count;
    });
  }
  if (Array.isArray(payload.users)) {
    await step('users', async () => (await restoreUsersFromBackup(payload.users)).restored);
  }

  return { summary, errors, exportedAt: payload.exportedAt ?? null };
}
