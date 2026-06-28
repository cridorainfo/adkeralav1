import { useState } from 'react';
import { sendDriverDrive, loadCloudUrl } from '../lib/driverPhone.js';

/** Cloud drive controls — queues commands to the bus (~5s when online). */
export default function DriverRemoteControl({ driverId, session, onDriveMessage }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const online = Boolean(session?.online);
  const trip = session?.trip ?? {};
  const tripStarted = Boolean(trip.tripStarted);
  const tripEnded = Boolean(trip.tripEnded);
  const inProgress = tripStarted && !tripEnded;

  async function sendDrive(action) {
    if (!driverId || !online) {
      const err = 'Bus is offline';
      setMessage(err);
      onDriveMessage?.(err);
      return;
    }
    if (action === 'endTrip' && !window.confirm('End trip on this bus?')) return;

    setBusy(true);
    setMessage('Sending…');
    try {
      const json = await sendDriverDrive(driverId, action, loadCloudUrl());
      if (!json.ok) {
        setMessage(json.error ?? 'Failed');
        onDriveMessage?.(json.error ?? 'Failed');
        return;
      }
      const ok = `Queued ${action}`;
      setMessage(`${ok} — bus applies in ~5s`);
      onDriveMessage?.(ok);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="driver-remote-control">
      <h2 className="driver-remote-control-title">Drive control</h2>
      <p className="hint driver-remote-control-hint">
        Commands go through cloud to the bus. For routes, ads, and GPS auto-drive, use{' '}
        <strong>Full control</strong> on bus Wi‑Fi.
      </p>

      <div className="driver-trip-status">
        <div>
          <span className="driver-trip-label">Route</span>
          <strong>{trip.routeName ?? '—'}</strong>
        </div>
        <div>
          <span className="driver-trip-label">Current stop</span>
          <strong>{trip.currentStopEn ?? '—'}</strong>
        </div>
        <div>
          <span className="driver-trip-label">Next stop</span>
          <strong>{trip.nextStopEn ?? '—'}</strong>
        </div>
        <div>
          <span className="driver-trip-label">Trip</span>
          <strong>
            {!tripStarted ? 'Not started' : tripEnded ? 'Ended' : 'In progress'}
          </strong>
        </div>
      </div>

      <div className="driver-drive-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!online || busy || inProgress}
          onClick={() => sendDrive('startTrip')}
        >
          Start trip
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!online || busy || !inProgress}
          onClick={() => sendDrive('forward')}
        >
          Forward
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!online || busy || !inProgress}
          onClick={() => sendDrive('announce')}
        >
          Announce
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={!online || busy || !inProgress}
          onClick={() => sendDrive('endTrip')}
        >
          End trip
        </button>
      </div>

      {!online && (
        <p className="hint driver-remote-offline">Bus offline — start the bus PC app to drive remotely.</p>
      )}
      {message && <p className="hint driver-drive-feedback">{message}</p>}
    </div>
  );
}
