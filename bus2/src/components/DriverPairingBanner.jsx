/** Passenger display overlay — plate + pairing code until a driver links. */
export default function DriverPairingBanner({ busProfile, driverLink, compact = false }) {
  const plate = busProfile?.plateDisplay || busProfile?.plate || '';
  const code = busProfile?.pairingCode ?? '';

  if (driverLink?.driverId) {
    return (
      <div className="driver-pairing-badge driver-pairing-badge--linked" role="status">
        Driver connected
      </div>
    );
  }

  if (!code) return null;

  return (
    <div
      className={`driver-pairing-banner${compact ? ' driver-pairing-banner--compact' : ''}`}
      role="status"
      aria-label={`Pairing code ${code}${plate ? ` for ${plate}` : ''}`}
    >
      {plate && <div className="driver-pairing-plate">{plate}</div>}
      <div className="driver-pairing-code-row">
        <span className="driver-pairing-label">Driver code</span>
        <strong className="driver-pairing-code">{code}</strong>
      </div>
      {!compact && (
        <p className="driver-pairing-hint">Enter plate or code in the AdKerala Driver app</p>
      )}
    </div>
  );
}
