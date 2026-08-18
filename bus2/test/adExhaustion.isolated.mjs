// Run as a child process with DATA_DIR/DATABASE_URL set by adExhaustion.test.mjs — cloud/store.js
// reads DATA_DIR from process.env at module load time, so this needs to happen in a fresh process
// before any cloud/*.js module is imported, same reasoning as test/fleetEnroll.isolated.mjs.
import assert from 'node:assert/strict';
import { stampExhaustion } from '../cloud/adExhaustion.js';
import { createCampaign } from '../cloud/campaigns.js';
import { recordAdPlays } from '../cloud/store.js';

const admin = { id: 'admin-1', role: 'admin' };
const busId = 'bus-1';

function playEvent(adId, n, playedAt = Date.now()) {
  return { id: `${adId}-play-${n}-${Math.random()}`, adId, playedAt, durationPlayedSec: 10 };
}

// stampExhaustion looks up the owning campaign via ad.campaignId — in production that's stamped
// onto each ad by pushCampaignToBuses when a campaign is pushed to its target buses; replicate
// that same stamp here directly rather than going through the full push (which also needs
// busProfiles/enqueueCommand plumbing this test doesn't otherwise need).
async function createPushedCampaign(body) {
  const { campaign } = await createCampaign(admin, body);
  const ad = { ...campaign.ads[0], campaignId: campaign.id };
  return { campaign, ad };
}

// --- Money-only ad: behaves exactly as before (regression guard) ---
{
  const { ad } = await createPushedCampaign({
    name: 'money-only',
    targetBusIds: ['bus-1', 'bus-2'],
    ads: [{ id: 'ad-money', durationSec: 10, amount: 100 }],
  });
  const [stamped] = await stampExhaustion([ad], busId);
  assert.equal('weeklyPerBusTarget' in stamped, false, 'no weekly fields on a money-only ad');
  assert.equal(stamped.exhaustedBySpend, false);
  console.log('money-only ad: ok');
}

// --- Weekly-only ad: stamped correctly, exhausted reflects the weekly cap ---
{
  const { ad } = await createPushedCampaign({
    name: 'weekly-only',
    targetBusIds: ['bus-1', 'bus-2'], // 2 buses -> weeklyPerBusTarget = round(10/2) = 5
    ads: [{ id: 'ad-weekly', durationSec: 10, weeklyViewTarget: 10 }],
  });

  const [freshStamp] = await stampExhaustion([ad], busId);
  assert.equal(freshStamp.weeklyPerBusTarget, 5);
  assert.equal(freshStamp.weeklyViewsUsed, 0);
  assert.equal(freshStamp.weeklyPlaysRemaining, 5);
  assert.equal(freshStamp.exhausted, false);
  assert.equal('playQuota' in freshStamp, false, 'no money-budget fields on a weekly-only ad');

  await recordAdPlays(busId, [
    playEvent('ad-weekly', 1),
    playEvent('ad-weekly', 2),
    playEvent('ad-weekly', 3),
    playEvent('ad-weekly', 4),
    playEvent('ad-weekly', 5),
  ]);
  const [afterFiveStamp] = await stampExhaustion([ad], busId);
  assert.equal(afterFiveStamp.weeklyViewsUsed, 5);
  assert.equal(afterFiveStamp.weeklyPlaysRemaining, 0);
  assert.equal(afterFiveStamp.exhausted, true, 'must exhaust once this bus hits its weekly share');
  console.log('weekly-only ad: ok');
}

// --- Both set: exhausted if EITHER cap is hit ---
{
  const { ad } = await createPushedCampaign({
    name: 'both',
    targetBusIds: ['bus-1'], // 1 bus -> gets the whole quota/target
    ads: [{ id: 'ad-both', durationSec: 1, amount: 1000, weeklyViewTarget: 2 }],
  });

  // Weekly cap hit (2 plays), money budget nowhere near exhausted (durationSec=1, amount=1000).
  await recordAdPlays(busId, [playEvent('ad-both', 1), playEvent('ad-both', 2)]);
  const [weeklyHit] = await stampExhaustion([ad], busId);
  assert.equal(weeklyHit.weeklyPlaysRemaining, 0);
  assert.equal(weeklyHit.exhausted, true, 'weekly cap alone must be enough to exhaust the ad');
  console.log('both-set (weekly hit) ad: ok');
}

// --- House ads (no campaignId, no amount, no weeklyViewTarget) are never stamped ---
{
  const houseAd = { id: 'house-1', mediaUrl: 'x.mp4', isHouseAd: true };
  const [passthrough] = await stampExhaustion([houseAd], busId);
  assert.equal(passthrough, houseAd, 'a house ad must pass through completely untouched, same object reference');
  console.log('house ad passthrough: ok');
}

console.log('adExhaustion.isolated ok');
