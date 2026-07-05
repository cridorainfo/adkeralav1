import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { requireHubAuthUnlessLocal, normalizeClientState } from './hubSessions.js';
import { applyDriveAction, isDriveAction } from '../src/store/driveActions.js';
import { getDriverVisibleRoutes } from '../src/store/busStore.js';

/** Lightweight drive commands — small POST bodies, authoritative server-side merge. */
export function setupDriveApi(app, dataRoot) {
  app.post('/api/drive', requireHubAuthUnlessLocal, async (req, res) => {
    try {
      const action = String(req.body?.action ?? '').trim();
      if (!isDriveAction(action)) {
        res.status(400).json({ ok: false, error: 'Invalid drive action' });
        return;
      }

      const raw = (await readInfoFile(dataRoot)) ?? {};
      const current = normalizeClientState(raw);
      const payload = { ...req.body };
      delete payload.action;

      if (action === 'startTrip' && !getDriverVisibleRoutes(current).length) {
        res.status(409).json({
          ok: false,
          error: 'No route on bus yet — wait for fleet sync or assign a route',
          code: 'NO_ROUTE',
        });
        return;
      }

      const next = applyDriveAction(current, action, payload);
      const changed =
        next !== current &&
        ((next.savedAt ?? 0) !== (current.savedAt ?? 0) ||
          (next.driveRevision ?? 0) !== (current.driveRevision ?? 0) ||
          JSON.stringify(next.announcementRequest ?? null) !==
            JSON.stringify(current.announcementRequest ?? null));

      if (!changed) {
        if (action === 'startTrip' && !next.tripStarted) {
          res.status(409).json({
            ok: false,
            error: 'Could not start trip — route not ready on bus PC',
            code: 'NO_ROUTE',
          });
          return;
        }
        res.json({
          ok: true,
          changed: false,
          savedAt: current.savedAt ?? 0,
          driveRevision: current.driveRevision ?? 0,
          activeRouteId: current.activeRouteId ?? null,
          tripStarted: Boolean(current.tripStarted),
          tripEnded: Boolean(current.tripEnded),
          currentStopIndex: current.currentStopIndex ?? 0,
        });
        return;
      }

      await writeInfoFileSerialized(dataRoot, next, { source: 'drive-api' });
      res.json({
        ok: true,
        changed: true,
        savedAt: next.savedAt ?? Date.now(),
        driveRevision: next.driveRevision ?? 0,
        activeRouteId: next.activeRouteId ?? null,
        tripStarted: Boolean(next.tripStarted),
        tripEnded: Boolean(next.tripEnded),
        tripDeparted: Boolean(next.tripDeparted),
        currentStopIndex: next.currentStopIndex ?? 0,
        routeDirection: next.routeDirection ?? 'forward',
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
