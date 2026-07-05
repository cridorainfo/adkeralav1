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

function isRawDriverConnected(state) {
  return (state?.connectedDeviceCount ?? 0) > 0 || Boolean(state?.driverLink?.driverId);
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
  const [showQr, setShowQr] = useState(() => !isRawDriverConnected(state));
  const hadSessionRef = useRef(isRawDriverConnected(state));
  const lastDisconnectAtRef = useRef(readDisconnectAt(state));
  const lastPairingCodeRef = useRef(state?.busProfile?.pairingCode ?? '');
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const rawConnected = isRawDriverConnected(state);
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

    if (rawConnected) {
      hadSessionRef.current = true;
      lastDisconnectAtRef.current = disconnectAt;
      lastPairingCodeRef.current = pairingCode;
      setShowQr(false);
      return undefined;
    }

    // Paired driver still linked — ignore connectedDeviceCount blips from sync.
    if (hasStableDriverLink(state)) {
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
      if (!isRawDriverConnected(latest)) {
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
