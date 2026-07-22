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
