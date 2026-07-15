import {
  loadStore,
  getAdPlaysRaw,
  getAdPlaysForBus,
  getPricingSettings,
  getHouseAds,
  getStopVoiceAdsCatalog,
} from './store.js';
import { computeAdSpend, isAdExhausted } from './pricing.js';

/**
 * Scan campaigns + house ads + stop-voice catalog for a given ad id.
 * Returns null when the ad is no longer in any catalog (orphan play logs).
 */
export async function findAdMetaById(adId) {
  if (!adId) return null;
  const store = await loadStore();

  for (const campaign of Object.values(store.adCampaigns ?? {})) {
    const fullscreen = (campaign.ads ?? []).find((ad) => ad.id === adId);
    if (fullscreen) {
      return {
        ad: fullscreen,
        format: 'fullscreen',
        source: campaign.name || 'Campaign',
        campaignId: campaign.id,
        isHouseAd: false,
      };
    }
    const banner = (campaign.bannerAds ?? []).find((ad) => ad.id === adId);
    if (banner) {
      return {
        ad: banner,
        format: 'banner',
        source: campaign.name || 'Campaign',
        campaignId: campaign.id,
        isHouseAd: false,
      };
    }
  }

  const { stopVoiceAds } = await getStopVoiceAdsCatalog();
  const audio = Object.values(stopVoiceAds ?? {}).find((entry) => entry.id === adId);
  if (audio) {
    const campaign = audio.campaignId ? store.adCampaigns?.[audio.campaignId] : null;
    return {
      ad: audio,
      format: 'audio',
      source: campaign?.name || (audio.campaignId ? 'Campaign (deleted)' : 'Stop voice'),
      campaignId: audio.campaignId ?? null,
      isHouseAd: false,
    };
  }

  const houseAds = await getHouseAds();
  const houseFullscreen = (houseAds.ads ?? []).find((ad) => ad.id === adId);
  if (houseFullscreen) {
    return {
      ad: houseFullscreen,
      format: 'fullscreen',
      source: 'House ad',
      campaignId: null,
      isHouseAd: true,
    };
  }
  const houseBanner = (houseAds.bannerAds ?? []).find((ad) => ad.id === adId);
  if (houseBanner) {
    return {
      ad: houseBanner,
      format: 'banner',
      source: 'House ad',
      campaignId: null,
      isHouseAd: true,
    };
  }

  return null;
}

/** Every known ad across campaigns + house + audio stop-ads, deduped by id. */
async function listAllKnownAds() {
  const store = await loadStore();
  const byId = new Map();

  for (const campaign of Object.values(store.adCampaigns ?? {})) {
    for (const ad of campaign.ads ?? []) {
      if (!ad?.id || byId.has(ad.id)) continue;
      byId.set(ad.id, {
        ad,
        format: 'fullscreen',
        source: campaign.name || 'Campaign',
        campaignId: campaign.id,
        isHouseAd: false,
      });
    }
    for (const ad of campaign.bannerAds ?? []) {
      if (!ad?.id || byId.has(ad.id)) continue;
      byId.set(ad.id, {
        ad,
        format: 'banner',
        source: campaign.name || 'Campaign',
        campaignId: campaign.id,
        isHouseAd: false,
      });
    }
  }

  const { stopVoiceAds } = await getStopVoiceAdsCatalog();
  for (const audio of Object.values(stopVoiceAds ?? {})) {
    if (!audio?.id || byId.has(audio.id)) continue;
    const campaign = audio.campaignId ? store.adCampaigns?.[audio.campaignId] : null;
    byId.set(audio.id, {
      ad: audio,
      format: 'audio',
      source: campaign?.name || (audio.campaignId ? 'Campaign (deleted)' : 'Stop voice'),
      campaignId: audio.campaignId ?? null,
      isHouseAd: false,
    });
  }

  const houseAds = await getHouseAds();
  for (const ad of houseAds.ads ?? []) {
    if (!ad?.id || byId.has(ad.id)) continue;
    byId.set(ad.id, {
      ad,
      format: 'fullscreen',
      source: 'House ad',
      campaignId: null,
      isHouseAd: true,
    });
  }
  for (const ad of houseAds.bannerAds ?? []) {
    if (!ad?.id || byId.has(ad.id)) continue;
    byId.set(ad.id, {
      ad,
      format: 'banner',
      source: 'House ad',
      campaignId: null,
      isHouseAd: true,
    });
  }

  return [...byId.values()];
}

function adDisplayName(ad) {
  return ad?.name?.trim() || ad?.audioFile || ad?.mediaFile?.split('/').pop() || ad?.id || 'Ad';
}

function serializeAdRow({ ad, format, source, campaignId, isHouseAd }, { plays, spend, budget }) {
  const amount = Number.isFinite(Number(ad.amount)) && Number(ad.amount) > 0 ? Number(ad.amount) : null;
  return {
    adId: ad.id,
    name: adDisplayName(ad),
    format,
    source,
    campaignId: campaignId ?? null,
    isHouseAd: Boolean(isHouseAd),
    mediaFile: ad.mediaFile ?? null,
    type: ad.type ?? null,
    plays,
    spend,
    budget: amount,
    exhausted: amount != null ? isAdExhausted(amount, spend) : false,
  };
}

/**
 * Per-bus ad analytics: plays + computed spend for every ad that ever played on this bus.
 */
export async function getBusAdAnalytics(busId) {
  const plays = await getAdPlaysForBus(busId);
  const pricingSettings = await getPricingSettings();

  const byAd = new Map();
  for (const play of plays) {
    const key = play.adId;
    const bucket = byAd.get(key) ?? { format: play.format, plays: [] };
    // Prefer a non-fullscreen format stamp if any play recorded one.
    if (play.format === 'banner' || play.format === 'audio') bucket.format = play.format;
    bucket.plays.push({ playedAt: play.playedAt, durationPlayedSec: play.durationPlayedSec });
    byAd.set(key, bucket);
  }

  const ads = [];
  let totalPlays = 0;
  let totalSpend = 0;

  for (const [adId, bucket] of byAd) {
    const meta = await findAdMetaById(adId);
    const format = meta?.format ?? bucket.format ?? 'fullscreen';
    const { spend } = computeAdSpend(bucket.plays, format, pricingSettings);
    const playsCount = bucket.plays.length;
    totalPlays += playsCount;
    totalSpend += spend;

    const ad = meta?.ad ?? { id: adId, name: adId };
    ads.push(
      serializeAdRow(
        {
          ad,
          format,
          source: meta?.source ?? 'Unknown / removed',
          campaignId: meta?.campaignId ?? null,
          isHouseAd: meta?.isHouseAd ?? false,
        },
        {
          plays: playsCount,
          spend,
          budget: ad.amount,
        }
      )
    );
  }

  ads.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));

  return {
    busId,
    totalPlays,
    totalSpend,
    ads,
  };
}

/**
 * Fleet-wide ad analytics across every known campaign + house ad.
 * Consumed/total budgets only count budgeted (paid) ads — house ads are listed but
 * excluded from totalConsumed / totalBudget per product assumption.
 */
export async function getFleetAdAnalytics({ summaryOnly = false } = {}) {
  const known = await listAllKnownAds();
  const pricingSettings = await getPricingSettings();

  let totalPlays = 0;
  let totalConsumed = 0;
  let totalBudget = 0;
  const ads = [];

  for (const entry of known) {
    const rawPlays = await getAdPlaysRaw(entry.ad.id);
    const { spend } = computeAdSpend(rawPlays, entry.format, pricingSettings);
    const playsCount = rawPlays.length;
    totalPlays += playsCount;

    const amount =
      Number.isFinite(Number(entry.ad.amount)) && Number(entry.ad.amount) > 0
        ? Number(entry.ad.amount)
        : null;
    // Only budgeted paid ads contribute to the consumed/total money strip.
    if (amount != null && !entry.isHouseAd) {
      totalConsumed += spend;
      totalBudget += amount;
    }

    if (!summaryOnly) {
      ads.push(
        serializeAdRow(entry, {
          plays: playsCount,
          spend,
          budget: amount,
        })
      );
    }
  }

  if (!summaryOnly) {
    ads.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name));
  }

  return {
    totalConsumed,
    totalBudget,
    totalPlays,
    ads: summaryOnly ? undefined : ads,
  };
}
