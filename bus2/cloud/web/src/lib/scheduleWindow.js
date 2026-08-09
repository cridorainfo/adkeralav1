/** Admin-UI mirror of cloud/schedules.js's isScheduleWindowActive — same logic, duplicated
 * rather than shared since the admin web app and cloud server are separate bundles (same
 * reasoning as src/lib/scheduleWindow.js on the device side). Used to show "active now" /
 * "not active" on each schedule card without a round-trip. */

export const WEEKDAY_OPTIONS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

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

/** Short human summary of a schedule's window for display on its card, e.g. "Sat, Sun" or
 * "1 Dec – 31 Jan" or "Sat, Sun · 1 Dec – 31 Jan" — null (not "Every day") when unrestricted, so
 * callers can decide their own wording for the no-restriction case. */
export function describeScheduleWindow(schedule) {
  const parts = [];
  const days = schedule?.activeDays;
  if (Array.isArray(days) && days.length) {
    const order = WEEKDAY_OPTIONS.map((o) => o.key);
    const sorted = [...days].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    parts.push(sorted.map((d) => WEEKDAY_OPTIONS.find((o) => o.key === d)?.label ?? d).join(', '));
  }
  if (schedule?.startDate || schedule?.endDate) {
    const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '…');
    parts.push(`${fmt(schedule.startDate)} – ${fmt(schedule.endDate)}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
