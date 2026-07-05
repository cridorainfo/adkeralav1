import { readInfoFile, writeInfoFileSerialized } from './dbApi.js';
import { requireHubAuthUnlessLocal } from './hubSessions.js';
import { applyDriveAction, isDriveAction } from '../src/store/driveActions.js';

/** Lightweight drive commands — small POST bodies, authoritative server-side merge. */
export function setupDriveApi(app, dataRoot) {
  app.post('/api/drive', requireHubAuthUnlessLocal, async (req, res) => {
    try {
      const action = String(req.body?.action ?? '').trim();
      if (!isDriveAction(action)) {
        res.status(400).json({ ok: false, error: 'Invalid drive action' });
        return;
      }

      const current = (await readInfoFile(dataRoot)) ?? {};
      const payload = { ...req.body };
      delete payload.action;

      const next = applyDriveAction(current, action, payload);
      const changed =
        next !== current &&
        ((next.savedAt ?? 0) !== (current.savedAt ?? 0) ||
          (next.driveRevision ?? 0) !== (current.driveRevision ?? 0) ||
          JSON.stringify(next.announcementRequest ?? null) !==
            JSON.stringify(current.announcementRequest ?? null));

      if (!changed) {
        res.json({
          ok: true,
          changed: false,
          savedAt: current.savedAt ?? 0,
          driveRevision: current.driveRevision ?? 0,
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
        currentStopIndex: next.currentStopIndex ?? 0,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
