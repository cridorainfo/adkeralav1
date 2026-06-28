/** Linked bus summary for the driver connect page. */
export default function DriverBusInfo({ session }) {
  if (!session?.linked && !session?.busId) return null;

  const busName = String(session.displayName ?? '').trim();
  const busNumber = String(session.plateNumber ?? session.plate ?? '').trim();
  const fleetId = session.busId ?? '';

  return (
    <div className="driver-bus-info">
      <div className="driver-bus-info-row">
        <span className="driver-bus-info-label">Bus name</span>
        <strong className="driver-bus-info-value">{busName || '—'}</strong>
      </div>
      <div className="driver-bus-info-row">
        <span className="driver-bus-info-label">Bus number</span>
        <strong className="driver-bus-info-value">{busNumber || '—'}</strong>
      </div>
      {fleetId ? (
        <div className="driver-bus-info-row muted">
          <span className="driver-bus-info-label">Fleet ID</span>
          <code className="driver-bus-info-code">{fleetId}</code>
        </div>
      ) : null}
    </div>
  );
}
