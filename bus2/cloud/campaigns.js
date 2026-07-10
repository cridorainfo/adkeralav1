import { randomUUID } from 'crypto';
import { withMediaFiles } from './fleet.js';
import {
  loadStore,
  saveStore,
  enqueueCommand,
  setBusAdsCatalog,
  getAdPlaysRaw,
  getPricingSettings,
  getStopVoiceAdsCatalog,
  setStopVoiceAdsCatalog,
  getPlaysGroupedByAdBusRoute,
  getRouteById,
} from './store.js';
import { computeAdSpend, isAdExhausted } from './pricing.js';

/** Every audio stop-ad currently attached to this campaign (campaignId match), format 'audio'. */
async function linkedAudioAds(campaignId) {
  const { stopVoiceAds } = await getStopVoiceAdsCatalog();
  return Object.values(stopVoiceAds ?? {}).filter((entry) => entry.campaignId === campaignId);
}

/**
 * A campaign is "completed" once every ad belonging to it — fullscreen, banner, and any
 * linked audio stop-ad — that has a budget set has spent through that budget. Not a stored
 * status transition (see cloud/server.js's stampExhaustion for the equivalent per-ad pattern);
 * computed fresh from current plays + pricing each time so admins always see a live answer.
 * A campaign with no budgeted ads at all never "completes".
 */
export async function isCampaignComplete(campaign) {
  const audioAds = await linkedAudioAds(campaign.id);
  const entries = [
    ...(campaign.ads ?? []).map((ad) => ({ ad, format: 'fullscreen' })),
    ...(campaign.bannerAds ?? []).map((ad) => ({ ad, format: 'banner' })),
    ...audioAds.map((ad) => ({ ad, format: 'audio' })),
  ].filter(({ ad }) => Number.isFinite(Number(ad.amount)) && Number(ad.amount) > 0);

  if (!entries.length) return false;

  const pricingSettings = await getPricingSettings();
  const exhaustedFlags = await Promise.all(
    entries.map(async ({ ad, format }) => {
      const plays = await getAdPlaysRaw(ad.id);
      const { spend } = computeAdSpend(plays, format, pricingSettings);
      return isAdExhausted(ad.amount, spend);
    })
  );
  return exhaustedFlags.every(Boolean);
}

/** How many times each of a campaign's ads played, broken down by bus and by route — the
 * "completed campaign" report. routeId is only present on plays recorded after the Phase 1
 * tracking rollout, so older plays land in the 'Unassigned' bucket rather than being dropped. */
export async function getCampaignReport(campaignId) {
  const campaign = await getCampaign(campaignId);
  if (!campaign) return null;

  const audioAds = await linkedAudioAds(campaignId);
  const entries = [
    ...(campaign.ads ?? []).map((ad) => ({ ad, format: 'fullscreen' })),
    ...(campaign.bannerAds ?? []).map((ad) => ({ ad, format: 'banner' })),
    ...audioAds.map((ad) => ({ ad, format: 'audio' })),
  ];

  const grouped = await getPlaysGroupedByAdBusRoute(entries.map(({ ad }) => ad.id));
  const routeIds = new Set();
  for (const bucket of Object.values(grouped)) {
    for (const routeId of Object.keys(bucket.byRoute)) {
      if (routeId !== '__unassigned__') routeIds.add(routeId);
    }
  }
  const routes = await Promise.all([...routeIds].map((id) => getRouteById(id)));
  const routeNames = new Map(routes.filter(Boolean).map((r) => [r.id, r.name]));

  const byAd = entries.map(({ ad, format }) => {
    const bucket = grouped[ad.id] ?? { totalPlays: 0, byBus: {}, byRoute: {} };
    return {
      adId: ad.id,
      format,
      name: ad.name || ad.audioFile || ad.id,
      totalPlays: bucket.totalPlays,
      byBus: Object.entries(bucket.byBus).map(([busId, plays]) => ({ busId, plays })),
      byRoute: Object.entries(bucket.byRoute).map(([routeId, plays]) => ({
        routeId: routeId === '__unassigned__' ? null : routeId,
        routeName: routeId === '__unassigned__' ? 'Unassigned' : routeNames.get(routeId) ?? routeId,
        plays,
      })),
    };
  });

  return { campaignId, byAd };
}

export async function listCampaigns(user) {
  const store = await loadStore();
  if (!store.adCampaigns) store.adCampaigns = {};

  let campaigns = Object.values(store.adCampaigns);
  if (user.role === 'advertiser') {
    campaigns = campaigns.filter((c) => c.advertiserId === user.id);
  }
  campaigns = campaigns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return Promise.all(
    campaigns.map(async (c) => ({ ...c, completed: await isCampaignComplete(c) }))
  );
}

/**
 * Returns a shallow copy, not the live store object — updateCampaign() mutates
 * campaign.ads/bannerAds in place on the cached store, so a caller snapshotting "before" state
 * (e.g. to diff which media files got removed) would otherwise see its own snapshot change
 * underneath it once the update runs.
 */
export async function getCampaign(id) {
  const store = await loadStore();
  const campaign = store.adCampaigns?.[id];
  if (!campaign) return null;
  return { ...campaign, ads: [...(campaign.ads ?? [])], bannerAds: [...(campaign.bannerAds ?? [])] };
}

/** Finds the campaign that owns a given ad id — used to authorize per-ad spend lookups (an
 * advertiser must not be able to see another advertiser's ad spend just by guessing an id). */
export async function findCampaignByAdId(adId) {
  const store = await loadStore();
  for (const campaign of Object.values(store.adCampaigns ?? {})) {
    if ((campaign.ads ?? []).some((ad) => ad.id === adId)) return campaign;
    if ((campaign.bannerAds ?? []).some((ad) => ad.id === adId)) return campaign;
  }
  // Audio stop-ads aren't stored inside the campaign object (authoring stays in
  // StopsCatalog.jsx) — they're referenced by campaignId instead, so resolve the other way.
  const { stopVoiceAds } = await getStopVoiceAdsCatalog();
  const linked = Object.values(stopVoiceAds ?? {}).find((entry) => entry.id === adId);
  if (linked?.campaignId) return store.adCampaigns?.[linked.campaignId] ?? null;
  return null;
}

/** Which pricing bucket an ad belongs to, by checking list membership within its campaign —
 * ads don't carry their own format field, they're just implicitly fullscreen/banner/audio by
 * which campaign list (or, for audio, the global stop-voice-ads catalog) references them. */
export async function adFormatInCampaign(campaign, adId) {
  if ((campaign?.ads ?? []).some((ad) => ad.id === adId)) return 'fullscreen';
  if ((campaign?.bannerAds ?? []).some((ad) => ad.id === adId)) return 'banner';
  const audioAds = await linkedAudioAds(campaign?.id);
  if (audioAds.some((ad) => ad.id === adId)) return 'audio';
  return 'fullscreen';
}

export async function createCampaign(user, body) {
  const store = await loadStore();
  if (!store.adCampaigns) store.adCampaigns = {};

  const id = randomUUID();
  const campaign = {
    id,
    advertiserId: user.role === 'admin' && body.advertiserId ? body.advertiserId : user.id,
    name: String(body.name ?? 'Untitled campaign').trim(),
    ads: Array.isArray(body.ads) ? body.ads : [],
    bannerAds: Array.isArray(body.bannerAds) ? body.bannerAds : [],
    targetBusIds: Array.isArray(body.targetBusIds) ? body.targetBusIds : [],
    status: user.role === 'admin' ? (body.status ?? 'active') : 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.adCampaigns[id] = campaign;
  await saveStore();
  return { ok: true, campaign };
}

export async function updateCampaign(id, user, patch) {
  const store = await loadStore();
  const campaign = store.adCampaigns?.[id];
  if (!campaign) return { ok: false, error: 'Campaign not found' };

  if (user.role === 'advertiser' && campaign.advertiserId !== user.id) {
    return { ok: false, error: 'Forbidden' };
  }

  if (patch.name != null) campaign.name = String(patch.name).trim();
  if (patch.ads != null) campaign.ads = patch.ads;
  if (patch.bannerAds != null) campaign.bannerAds = patch.bannerAds;
  if (patch.targetBusIds != null) campaign.targetBusIds = patch.targetBusIds;

  if (patch.status != null) {
    if (user.role === 'admin') {
      campaign.status = patch.status;
    } else if (user.role === 'advertiser' && patch.status === 'paused') {
      campaign.status = 'paused';
    }
  }

  campaign.updatedAt = Date.now();
  await saveStore();
  return { ok: true, campaign };
}

export async function deleteCampaign(id, user) {
  const store = await loadStore();
  const campaign = store.adCampaigns?.[id];
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (user.role === 'advertiser' && campaign.advertiserId !== user.id) {
    return { ok: false, error: 'Forbidden' };
  }
  delete store.adCampaigns[id];
  await saveStore();
  return { ok: true, deleted: id };
}

/**
 * Reruns a completed campaign with fresh budgets — clones its ads/banners under new ids (never
 * reuse an id, or the new run's plays would merge into the old one's history) into a brand new
 * campaign; the original is never touched, so its report stays exactly as it was. Audio stop-ads
 * can't be "cloned" the same way (one catalog entry per stop, see setStopVoiceAdsCatalog) — a
 * rerun re-attaches the same clip to the new campaign for future plays instead. That doesn't
 * touch the original's historical report: play records carry the campaignId they were stamped
 * with at play-time, not a live lookup, so past audio plays still count toward the original.
 */
export async function rerunCampaign(id, user, body = {}) {
  const original = await getCampaign(id);
  if (!original) return { ok: false, error: 'Campaign not found' };
  if (user.role === 'advertiser' && original.advertiserId !== user.id) {
    return { ok: false, error: 'Forbidden' };
  }

  const amountFor = (list, adId) => {
    const entry = (list ?? []).find((x) => x.adId === adId);
    const amount = Number(entry?.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : undefined;
  };

  const cloneAd = (ad, amounts) => {
    const { campaignId, ...rest } = ad;
    const amount = amountFor(amounts, ad.id);
    return { ...rest, id: randomUUID(), ...(amount != null ? { amount } : {}) };
  };

  const store = await loadStore();
  if (!store.adCampaigns) store.adCampaigns = {};
  const newId = randomUUID();
  const campaign = {
    id: newId,
    advertiserId: original.advertiserId,
    name: original.name,
    ads: (original.ads ?? []).map((ad) => cloneAd(ad, body.ads)),
    bannerAds: (original.bannerAds ?? []).map((ad) => cloneAd(ad, body.bannerAds)),
    targetBusIds: Array.isArray(body.targetBusIds) ? body.targetBusIds : original.targetBusIds ?? [],
    status: 'active',
    rerunOf: original.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.adCampaigns[newId] = campaign;
  await saveStore();

  const stopVoiceAmounts = body.stopVoiceAds;
  if (Array.isArray(stopVoiceAmounts) && stopVoiceAmounts.length) {
    const { stopVoiceAds } = await getStopVoiceAdsCatalog();
    const next = { ...stopVoiceAds };
    for (const [key, entry] of Object.entries(stopVoiceAds)) {
      if (entry.campaignId !== original.id) continue;
      const amount = amountFor(stopVoiceAmounts, entry.id);
      if (amount == null) continue;
      next[key] = { ...entry, campaignId: newId, amount };
    }
    await setStopVoiceAdsCatalog(next);
  }

  return { ok: true, campaign };
}

export async function pushCampaignToBuses(id, user, busProfiles) {
  const campaign = await getCampaign(id);
  if (!campaign) return { ok: false, error: 'Campaign not found' };
  if (campaign.status !== 'active' && user.role !== 'admin') {
    return { ok: false, error: 'Campaign must be active before pushing' };
  }

  const queued = [];
  for (const busId of campaign.targetBusIds ?? []) {
    if (user.role === 'bus_owner') {
      const profile = busProfiles?.[busId];
      if (profile?.ownerId !== user.id) continue;
    }
    const adsSavedAt = Date.now();
    // Stamp campaignId onto each ad so play events the bus reports later (POST .../ad-plays)
    // can be attributed back to this campaign without a separate lookup.
    const stampCampaign = (ad) => ({ ...ad, campaignId: campaign.id });
    const catalog = await setBusAdsCatalog(busId, {
      ads: (campaign.ads ?? []).map(stampCampaign),
      bannerAds: (campaign.bannerAds ?? []).map(stampCampaign),
      adsSavedAt,
      source: 'campaign',
    });
    const cmd = await enqueueCommand(
      busId,
      'UPDATE_ADS',
      withMediaFiles({
        ads: catalog.ads,
        bannerAds: catalog.bannerAds,
        adsSavedAt: catalog.adsSavedAt,
        savedAt: adsSavedAt,
      })
    );
    queued.push({ busId, commandId: cmd.id });
  }
  return { ok: true, queued };
}
