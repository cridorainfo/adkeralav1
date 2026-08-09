/** Ad pricing — computes spend against an ad's budget from reported plays, using a global
 * rate-per-second with a higher rate during admin-configured peak-hour windows.
 *
 * Cost is recomputed from raw play events + the *current* pricing settings every time it's
 * asked for, rather than stored per-event — simplest correct option for v1. If admin changes
 * the rate or peak-hours definition later, historical spend recalculates under the new
 * definition instead of staying locked to whatever was in effect when each play happened.
 */

const PEAK_TIMEZONE = 'Asia/Kolkata';

/** Minutes since local midnight (default Asia/Kolkata, matching the rest of the display's
 * clock handling) for a given timestamp. */
export function minuteOfDay(timestampMs, timeZone = PEAK_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

export function isPeakMinute(minute, peakHours = []) {
  return (peakHours ?? []).some((w) => minute >= w.startMin && minute < w.endMin);
}

/**
 * Splits an ad's raw play events into watched seconds and the resulting spend.
 * Fullscreen ads keep the peak/off-peak split; banner and audio ads use a flat
 * per-second rate each (no natural "peak attention" concept for those two, and
 * simpler for admins to reason about — see PricingPanel.jsx).
 */
export function computeAdSpend(plays, format, pricingSettings) {
  const {
    ratePerSecond = 0,
    peakRatePerSecond = 0,
    peakHours = [],
    bannerRatePerSecond = 0,
    audioRatePerSecond = 0,
  } = pricingSettings ?? {};

  if (format === 'banner' || format === 'audio') {
    const rate = format === 'banner' ? bannerRatePerSecond : audioRatePerSecond;
    const sec = (plays ?? []).reduce(
      (sum, play) => sum + Math.max(0, Number(play.durationPlayedSec) || 0),
      0
    );
    return { peakSec: 0, offPeakSec: sec, spend: sec * rate };
  }

  let peakSec = 0;
  let offPeakSec = 0;
  for (const play of plays ?? []) {
    const sec = Math.max(0, Number(play.durationPlayedSec) || 0);
    if (isPeakMinute(minuteOfDay(play.playedAt), peakHours)) {
      peakSec += sec;
    } else {
      offPeakSec += sec;
    }
  }
  const spend = peakSec * peakRatePerSecond + offPeakSec * ratePerSecond;
  return { peakSec, offPeakSec, spend };
}

/** True once an ad's accrued spend has reached its budget. Ads with no budget set (house ads,
 * or paid ads admin hasn't budgeted yet) never exhaust. */
export function isAdExhausted(amount, spend) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return false;
  return spend >= Number(amount);
}

/** Estimated cost of a single play of this ad, used only to translate a monetary budget into a
 * fixed play-count quota per bus (see computeBusPlayQuota / server.js stampExhaustion) — never
 * used for the real spend figures shown to admins, which stay based on actual reported
 * watch-time. Fullscreen uses the peak rate deliberately (the worst case): a bus enforcing a
 * quota sized this way can never, in aggregate, cost more than the ad's budget even if every
 * one of its plays happens to land in a peak window. */
export function estimateCostPerPlay(ad, format, pricingSettings) {
  const durationSec = Math.max(0, Number(ad?.durationSec) || 0);
  const {
    peakRatePerSecond = 0,
    bannerRatePerSecond = 0,
    audioRatePerSecond = 0,
  } = pricingSettings ?? {};
  const rate =
    format === 'banner' ? bannerRatePerSecond : format === 'audio' ? audioRatePerSecond : peakRatePerSecond;
  return durationSec * rate;
}

const WEEKDAY_INDEX = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Milliseconds elapsed since the start of the current Mon–Sun local week (Asia/Kolkata, same
 * timezone as the rest of this module) — the shared building block for weekly ad-view pacing:
 * spreading a "50 views/week" target evenly Monday through Sunday instead of letting it burn out
 * on day one. Local-calendar based (not a rolling 7×24h window), so "this week" resets cleanly
 * every Monday the way an admin reading a wall calendar would expect. */
export function msIntoWeek(timestampMs = Date.now(), timeZone = PEAK_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampMs));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const dayIndex = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const msIntoDay = ((Number(get('hour')) * 60 + Number(get('minute'))) * 60 + Number(get('second'))) * 1000;
  return dayIndex * 24 * 60 * 60 * 1000 + msIntoDay;
}

/** Start-of-week timestamp (ms) containing `timestampMs` — used to bucket raw play events into
 * "this week's plays" without pulling in a real calendar/timezone library. */
export function weekStartMs(timestampMs = Date.now(), timeZone = PEAK_TIMEZONE) {
  return timestampMs - msIntoWeek(timestampMs, timeZone);
}

/** Divides an ad's fleet-wide weekly view target into one bus's even share — same "split by how
 * many buses carry this ad" idea as computeBusPlayQuota below, just view-count instead of money.
 * Rounds rather than floors/ceils: being off by a view or two per bus matters less here than
 * staying close to an even split (unlike money, where floor guarantees never over-budget). */
export function computeWeeklyViewShare(weeklyViewTarget, busCount) {
  const target = Number(weeklyViewTarget);
  if (!Number.isFinite(target) || target <= 0) return null;
  const buses = Math.max(1, Number(busCount) || 0);
  return Math.max(1, Math.round(target / buses));
}

/** Divides an ad's total budget into a fixed play-count quota per bus it's targeted at, so each
 * bus can enforce its own hard stop locally — including while fully offline — instead of relying
 * on a live, fleet-wide spend check. Recomputed fresh every time (same "never cached" philosophy
 * as the rest of this module): if admin edits the budget, pricing rate, or the campaign's target
 * bus list, every bus picks up the new number next time it syncs. Returns null (no cap) when the
 * ad has no budget or cost can't be estimated (e.g. zero-duration ad, or rate not configured). */
export function computeBusPlayQuota({ amount, costPerPlay, busCount }) {
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return null;
  if (!Number.isFinite(Number(costPerPlay)) || Number(costPerPlay) <= 0) return null;
  const buses = Math.max(1, Number(busCount) || 0);
  return Math.max(1, Math.floor(Number(amount) / Number(costPerPlay) / buses));
}
