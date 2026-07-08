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

/** Splits an ad's raw play events into peak/off-peak watched seconds and the resulting spend. */
export function computeAdSpend(plays, pricingSettings) {
  const { ratePerSecond = 0, peakRatePerSecond = 0, peakHours = [] } = pricingSettings ?? {};
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
