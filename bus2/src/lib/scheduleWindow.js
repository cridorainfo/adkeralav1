/** On-device mirror of cloud/schedules.js's isScheduleWindowActive — same logic, duplicated
 * rather than shared since the display app and cloud server are separate bundles (same reasoning
 * as adPlayback.js/pricing.js's week-math duplication). Used by DisplayScreen.jsx to resolve
 * 'auto' bus mode: entertainment content only while the bus's pushed schedule's own
 * activeDays/startDate/endDate window is active right now, route view otherwise — re-checked
 * continuously against the device's own clock (the same 1s tick already driving the on-screen
 * clock), not just once at sync time, so a "weekends only" schedule flips over automatically at
 * midnight without needing a fresh push from the cloud.
 */

const SCHEDULE_TIMEZONE = 'Asia/Kolkata';

export function isScheduleWindowActive(schedule, now = Date.now()) {
  if (!schedule) return false;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHEDULE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`;
  const weekdayKey = String(get('weekday') ?? '').toLowerCase().slice(0, 3);

  const days = schedule.activeDays;
  if (Array.isArray(days) && days.length && !days.includes(weekdayKey)) return false;
  if (schedule.startDate && isoDate < schedule.startDate) return false;
  if (schedule.endDate && isoDate > schedule.endDate) return false;
  return true;
}
