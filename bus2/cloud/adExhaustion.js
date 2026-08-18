import { getAdPlaysRaw, getAdPlayCountForBus, getAdPlayCountForBusSince, getPricingSettings } from './store.js';
import { getCampaign } from './campaigns.js';
import {
  computeAdSpend,
  isAdExhausted,
  estimateCostPerPlay,
  computeBusPlayQuota,
  computeWeeklyViewShare,
  computeWeeklyPlaysRemaining,
  weekStartMs,
} from './pricing.js';

/**
 * Split out of server.js into its own side-effect-free module (importing only from store.js/
 * campaigns.js/pricing.js, none of which call app.listen()) so it can be imported directly by an
 * isolated test script the way fleet.js/campaigns.js/schedules.js already are — see
 * test/fleetEnroll.isolated.mjs for the established pattern this follows. Importing server.js
 * itself for a unit test isn't an option: it unconditionally starts a real HTTP server (and
 * warms up the store/DB) as a side effect of module load.
 *
 * Stamps `exhausted`/`playsRemaining`/`weeklyPlaysRemaining` onto each budgeted ad for one
 * specific bus, so the bus's own rotation (src/lib/adPlayback.js nextPlayableAdIndex) can skip
 * exhausted paid ads and fall back to house ads without needing any cloud round-trip of its own.
 * Budget/exhaustion is a fullscreen-only concept (banner ads aren't instrumented by endAd()'s
 * play tracking), so this only applies to the fullscreen list — banner house ads are appended
 * separately, unconditionally.
 *
 * Three enforcement mechanisms are combined, each independently optional per ad (an ad can carry
 * any, all, or none) and each individually enough to mark the ad `exhausted`:
 *  - `playsRemaining` (money-budget quota — a fixed per-bus play-count, this ad's budget divided
 *    across every bus its owning campaign targets) is what the bus itself enforces locally as
 *    plays happen — including fully offline — so it never "over-shows" past its share while
 *    waiting on a sync. The bus decrements its own copy as it plays
 *    (src/lib/adPlayback.js decrementAdQuota); this stamping just gives it a fresh authoritative
 *    number (quota minus this bus's actual all-time reported plays) each time it syncs.
 *  - `weeklyPlaysRemaining` (weekly-view hard cap — same idea, just reset every Mon–Sun local
 *    week instead of never) is enforced the same way: the bus decrements its own copy on every
 *    local play (adPlayback.js decrementAdQuota again — one pass handles both mechanisms), and
 *    additionally resets itself to a fresh allowance purely from the device's own clock if it's
 *    been offline across a week boundary (adPlayback.js effectiveWeeklyState) — this stamping
 *    gives it a fresh authoritative number (target minus this bus's actual reported plays *since
 *    this week started*) each time it syncs, reconciled without regressing local progress by
 *    server/cloudSync.js's reconcileAdsWeeklyFields.
 *  - `exhaustedBySpend` is additionally true once the ad's real fleet-wide spend reaches its
 *    budget — a belt-and-suspenders backstop for the rare case where the quota estimate (based on
 *    an assumed per-play cost) doesn't match actual watch-time. Stamped as its own field (not
 *    folded silently into `exhausted`) so the device can recompute `exhausted` from decomposed
 *    reasons rather than trust a flat boolean that a local weekly-cap rollover could never safely
 *    clear on its own.
 */
export async function stampExhaustion(list = [], busId, format = 'fullscreen') {
  const pricingSettings = await getPricingSettings();
  return Promise.all(
    list.map(async (ad) => {
      const hasAmount = Number.isFinite(Number(ad.amount)) && Number(ad.amount) > 0;
      // weeklyViewTarget is a separate, independent budget concept from `amount` (see
      // cloud/pricing.js computeWeeklyViewShare's doc comment) — an ad can carry either, both, or
      // neither, so this can't just piggyback on the hasAmount guard below it used to share.
      const hasWeeklyTarget = Number.isFinite(Number(ad.weeklyViewTarget)) && Number(ad.weeklyViewTarget) > 0;
      if (!hasAmount && !hasWeeklyTarget) return ad;

      let exhaustedBySpend = false;
      if (hasAmount) {
        const plays = await getAdPlaysRaw(ad.id);
        const { spend } = computeAdSpend(plays, format, pricingSettings);
        exhaustedBySpend = isAdExhausted(ad.amount, spend);
      }

      let playQuota = null;
      let playsUsed = null;
      let playsRemaining = null;
      let weeklyPerBusTarget = null;
      let weeklyViewsUsed = null;
      let weeklyPlaysRemaining = null;
      let weeklyWeekStartMs = null;
      const campaign = ad.campaignId ? await getCampaign(ad.campaignId) : null;
      if (campaign) {
        if (hasAmount) {
          const costPerPlay = estimateCostPerPlay(ad, format, pricingSettings);
          playQuota = computeBusPlayQuota({
            amount: ad.amount,
            costPerPlay,
            busCount: campaign.targetBusIds?.length ?? 0,
          });
          if (playQuota != null && busId) {
            playsUsed = await getAdPlayCountForBus(busId, ad.id);
            playsRemaining = Math.max(0, playQuota - playsUsed);
          }
        }

        // Weekly view hard cap (distinct from the money-budget quota above) — fullscreen-only,
        // same as the rest of this function's per-bus stamping. The bus-side rotation
        // (src/lib/adPlayback.js effectiveWeeklyState/decrementAdQuota) enforces this as a real
        // per-bus play-count cap for the current local week, not a soft pacing throttle.
        if (hasWeeklyTarget) {
          weeklyPerBusTarget = computeWeeklyViewShare(ad.weeklyViewTarget, campaign.targetBusIds?.length ?? 0);
          if (weeklyPerBusTarget != null && busId) {
            weeklyWeekStartMs = weekStartMs();
            weeklyViewsUsed = await getAdPlayCountForBusSince(busId, ad.id, weeklyWeekStartMs);
            weeklyPlaysRemaining = computeWeeklyPlaysRemaining(weeklyPerBusTarget, weeklyViewsUsed);
          }
        }
      }

      return {
        ...ad,
        exhaustedBySpend,
        exhausted: exhaustedBySpend
          || (playsRemaining != null && playsRemaining <= 0)
          || (weeklyPlaysRemaining != null && weeklyPlaysRemaining <= 0),
        ...(playQuota != null ? { playQuota, playsUsed, playsRemaining } : {}),
        ...(weeklyPerBusTarget != null
          ? { weeklyPerBusTarget, weeklyViewsUsed, weeklyPlaysRemaining, weeklyWeekStartMs }
          : {}),
      };
    })
  );
}
