import { useEffect, useRef, useState } from 'react';

/** Wait before showing QR after a drop in hub signals — ignores brief sync flicker. */
const DISCONNECT_DEBOUNCE_MS = 6000;

function readDisconnectAt(state) {
  return (
    state?.busProfile?.devicesDisconnectLastApplied ??
    state?.busProfile?.devicesDisconnectAt ??
    null
  );
}

function isHubLive(state) {
  return (state?.connectedDeviceCount ?? 0) > 0;
}

function hasStableDriverLink(state) {
  return Boolean(state?.driverLink?.driverId);
}

/**
 * Passenger display QR — show only when pairing is needed:
 * - no driver paired yet
 * - driver disconnected (stable, not a sync blip)
 * - admin disconnected all phones / rotated pairing code
 */
export function useShowDriverPairingQr(state) {
  const [showQr, setShowQr] = useState(() => !isHubLive(state));
  const hadSessionRef = useRef(isHubLive(state));
  const lastDisconnectAtRef = useRef(readDisconnectAt(state));
  const lastPairingCodeRef = useRef(state?.busProfile?.pairingCode ?? '');
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const disconnectAt = readDisconnectAt(state);
    const pairingCode = state?.busProfile?.pairingCode ?? '';

    const adminRevoked =
      (disconnectAt && String(disconnectAt) !== String(lastDisconnectAtRef.current)) ||
      (hadSessionRef.current &&
        pairingCode &&
        lastPairingCodeRef.current &&
        pairingCode !== lastPairingCodeRef.current);

    if (adminRevoked) {
      hadSessionRef.current = false;
      lastDisconnectAtRef.current = disconnectAt;
      lastPairingCodeRef.current = pairingCode;
      setShowQr(true);
      return undefined;
    }

    if (isHubLive(state)) {
      hadSessionRef.current = true;
      lastDisconnectAtRef.current = disconnectAt;
      lastPairingCodeRef.current = pairingCode;
      setShowQr(false);
      return undefined;
    }

    // Stale driverLink from cloud sync without a live hub session — keep QR visible.
    if (hasStableDriverLink(state) && hadSessionRef.current) {
      setShowQr(false);
      return undefined;
    }

    if (!hadSessionRef.current) {
      setShowQr(true);
      return undefined;
    }

    const timer = setTimeout(() => {
      const latest = stateRef.current;
      if (hasStableDriverLink(latest)) return;
      if (!isHubLive(latest)) {
        hadSessionRef.current = false;
        setShowQr(true);
      }
    }, DISCONNECT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [
    state?.connectedDeviceCount,
    state?.driverLink?.driverId,
    state?.busProfile?.devicesDisconnectLastApplied,
    state?.busProfile?.devicesDisconnectAt,
    state?.busProfile?.pairingCode,
  ]);

  return showQr;
}
