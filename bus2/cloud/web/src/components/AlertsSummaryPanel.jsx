import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { busDisplayLabel } from './BusContext.jsx';

// "Offline too long" is deliberately a much longer window than the ~20s "is it online right
// now" status dot elsewhere (FleetMap.jsx's isBusOnline) — a bus between trips or with patchy
// connectivity drops out for seconds-to-minutes routinely, that's not alert-worthy. This flags
// the case an admin actually wants to know about: a bus that's been dark long enough it's
// probably a real problem (powered off, network down, app crashed), not brief flakiness.
const OFFLINE_ALERT_MS = 2 * 60 * 60 * 1000; // 2 hours
const BUDGET_ALERT_PCT = 0.9;
const SCHEDULE_EXPIRY_ALERT_DAYS = 7;

/**
 * Lightweight fleet-health summary — offline-too-long buses, near-exhausted ad budgets, and
 * schedules expiring soon, computed client-side from data the dashboard already fetches
 * elsewhere (no new "alerting infrastructure": no email/webhook delivery, no persisted alert
 * state, just a glanceable summary on the page an admin already lands on). See the feature-gap
 * audit's finding on this — a full notification/delivery system is flagged there as a larger,
 * separate follow-up; this is the "can an admin even see the exceptions" half.
 */
export default function AlertsSummaryPanel() {
  const [offlineBuses, setOfflineBuses] = useState([]);
  const [nearBudgetAds, setNearBudgetAds] = useState([]);
  const [expiringSchedules, setExpiringSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [busesJson, adsJson, schedulesJson] = await Promise.all([
          api('/api/buses').catch(() => ({ buses: [] })),
          api('/api/analytics/ads-fleet').catch(() => ({ ads: [] })),
          api('/api/schedules').catch(() => ({ schedules: [] })),
        ]);
        if (cancelled) return;

        const now = Date.now();
        setOfflineBuses(
          (busesJson.buses ?? []).filter((b) => b.updatedAt && now - b.updatedAt > OFFLINE_ALERT_MS)
        );

        setNearBudgetAds(
          (adsJson.ads ?? []).filter((ad) => {
            if (ad.isHouseAd || ad.budget == null || ad.budget <= 0) return false;
            return ad.exhausted || ad.spend / ad.budget >= BUDGET_ALERT_PCT;
          })
        );

        const soonCutoff = now + SCHEDULE_EXPIRY_ALERT_DAYS * 24 * 60 * 60 * 1000;
        setExpiringSchedules(
          (schedulesJson.schedules ?? []).filter((s) => {
            if (!s.endDate) return false;
            const endMs = new Date(`${s.endDate}T23:59:59`).getTime();
            return endMs >= now && endMs <= soonCutoff;
          })
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAlerts = offlineBuses.length + nearBudgetAds.length + expiringSchedules.length;
  if (loading || dismissed || !totalAlerts) return null;

  return (
    <div className="card" style={{ borderColor: 'var(--status-warning-border, #f59e0b)' }}>
      <div className="campaigns-header">
        <h2>⚠ {totalAlerts} thing{totalAlerts === 1 ? '' : 's'} need attention</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>

      {offlineBuses.length > 0 && (
        <p className="hint">
          <strong>{offlineBuses.length} bus{offlineBuses.length === 1 ? '' : 'es'} offline 2+ hours:</strong>{' '}
          {offlineBuses.slice(0, 6).map((b) => busDisplayLabel(b)).join(', ')}
          {offlineBuses.length > 6 ? `, +${offlineBuses.length - 6} more` : ''}
        </p>
      )}
      {nearBudgetAds.length > 0 && (
        <p className="hint">
          <strong>
            {nearBudgetAds.length} ad{nearBudgetAds.length === 1 ? '' : 's'} at/near budget:
          </strong>{' '}
          {nearBudgetAds.slice(0, 6).map((ad) => ad.name).join(', ')}
          {nearBudgetAds.length > 6 ? `, +${nearBudgetAds.length - 6} more` : ''} — see Ads Report.
        </p>
      )}
      {expiringSchedules.length > 0 && (
        <p className="hint">
          <strong>
            {expiringSchedules.length} schedule{expiringSchedules.length === 1 ? '' : 's'} expiring within{' '}
            {SCHEDULE_EXPIRY_ALERT_DAYS} days:
          </strong>{' '}
          {expiringSchedules.slice(0, 6).map((s) => s.name).join(', ')}
          {expiringSchedules.length > 6 ? `, +${expiringSchedules.length - 6} more` : ''} — see Schedules.
        </p>
      )}
    </div>
  );
}
