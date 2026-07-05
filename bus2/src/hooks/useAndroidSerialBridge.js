import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** True when running inside the AdKerala Android TV WebView shell. */
export function isAndroidSerialAvailable() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.adKeralaAndroid?.serialSupported);
}

/**
 * Native USB serial bridge on Android TV — same button values as Web Serial on PC.
 * Events are dispatched from Kotlin via CustomEvent('adkerala-serial').
 */
export function useAndroidSerialBridge({ enabled, onValueChange }) {
  const [status, setStatus] = useState('idle');
  const [portLabel, setPortLabel] = useState('');
  const [lastLine, setLastLine] = useState('');
  const [error, setError] = useState('');
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;

  useEffect(() => {
    if (!enabled || !isAndroidSerialAvailable()) return undefined;

    const onSerial = (event) => {
      const value = event?.detail?.value;
      if (value == null) return;
      onValueChangeRef.current?.(String(value));
      setLastLine(String(value));
    };

    const onStatus = (event) => {
      const detail = event?.detail ?? {};
      if (detail.status) setStatus(detail.status);
      if (detail.portLabel != null) setPortLabel(detail.portLabel);
      if (detail.error != null) setError(detail.error);
    };

    window.addEventListener('adkerala-serial', onSerial);
    window.addEventListener('adkerala-serial-status', onStatus);
    window.adKeralaAndroid?.requestSerialStatus?.();

    return () => {
      window.removeEventListener('adkerala-serial', onSerial);
      window.removeEventListener('adkerala-serial-status', onStatus);
    };
  }, [enabled]);

  const selectPort = useCallback(async () => {
    window.adKeralaAndroid?.openSerialSettings?.();
  }, []);

  const disconnect = useCallback(async () => {
    window.adKeralaAndroid?.disconnectSerial?.();
  }, []);

  const reconnect = useCallback(async () => {
    window.adKeralaAndroid?.reconnectSerial?.();
    return true;
  }, []);

  return useMemo(
    () => ({
      status,
      portLabel,
      lastLine,
      error,
      setError: (msg) => setError(msg),
      clearError: () => setError(''),
      describeError: (err) => String(err?.message ?? err ?? 'Serial error'),
      isSupported: isAndroidSerialAvailable(),
      selectPort,
      disconnect,
      reconnect,
      getPortInfo: () => null,
      isConnected: status === 'connected',
      isActive: status !== 'idle',
    }),
    [status, portLabel, lastLine, error, selectPort, disconnect, reconnect]
  );
}
