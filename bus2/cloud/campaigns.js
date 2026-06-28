import { randomUUID } from 'crypto';
import { loadStore, saveStore, enqueueCommand } from './store.js';
import { withMediaFiles } from './fleet.js';

export async function listCampaigns(user) {
  const store = await loadStore();
  if (!store.adCampaigns) store.adCampaigns = {};

  let campaigns = Object.values(store.adCampaigns);
  if (user.role === 'advertiser') {
    campaigns = campaigns.filter((c) => c.advertiserId === user.id);
  }
  return campaigns.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export async function getCampaign(id) {
  const store = await loadStore();
  return store.adCampaigns?.[id] ?? null;
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
    const cmd = await enqueueCommand(
      busId,
      'UPDATE_ADS',
      withMediaFiles({
        ads: campaign.ads,
        bannerAds: campaign.bannerAds,
        savedAt: Date.now(),
      })
    );
    queued.push({ busId, commandId: cmd.id });
  }
  return { ok: true, queued };
}
