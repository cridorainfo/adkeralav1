import { useCallback, useEffect } from 'react';
import { isWebSerialSupported } from './useSerialPort';
import { usePlatformSerial, isPlatformSerialSupported } from './usePlatformSerial';
import { isAndroidSerialAvailable } from './useAndroidSerialBridge';
import { useEspSerialControl } from './useEspSerialControl';
import { refreshRemoteState } from './useRemoteStateSync';
import { getStopEn } from '../store/busStore';
import { postDriveAction } from '../lib/driverDriveApi';
import { isBusPcForSerial } from '../lib/appRole';

/** ESP32 USB on bus PC passenger display — settings come from driver phone via sync. */
export function useBusPcEspSerial({ state, applyRemoteState, updateSerialRuntime, updateSerialSettings }) {
  const active = isBusPcForSerial() && isPlatformSerialSupported();

  const drive = useCallback(
    async (action, payload = {}) => {
      await postDriveAction(action, payload);
      await refreshRemoteState(applyRemoteState);
    },
    [applyRemoteState]
  );

  const startTrip = useCallback(() => drive('startTrip'), [drive]);
  const endTrip = useCallback(() => drive('endTrip'), [drive]);
  const moveForward = useCallback(() => drive('forward'), [drive]);
  const undoForward = useCallback(() => drive('undo'), [drive]);
  const requestAnnouncement = useCallback(
    (stop, { isTerminus }) => {
      drive('announce', { stopEn: getStopEn(stop), isTerminus });
    },
    [drive]
  );

  const enterDisplayMode = useCallback(() => {}, []);
  const exitToControl = useCallback(() => {}, []);

  const { handleValueChange } = useEspSerialControl({
    state,
    startTrip,
    endTrip,
    moveForward,
    undoForward,
    requestAnnouncement,
    enterDisplayMode,
    exitToControl,
  });

  const serialSettings = state.serialSettings ?? {};
  const serialTextCommands = [
    serialSettings.fullscreenCommand ?? 'fullscreen',
    serialSettings.exitCommand ?? 'exit',
  ];

  const serial = usePlatformSerial({
    enabled:
      active &&
      (serialSettings.enabled ?? isAndroidSerialAvailable() ?? Boolean(serialSettings.savedPortInfo)),
    locked: serialSettings.portLocked ?? Boolean(serialSettings.savedPortInfo),
    baudRate: serialSettings.baudRate,
    savedPortInfo: serialSettings.savedPortInfo,
    onValueChange: handleValueChange,
    textCommands: serialTextCommands,
  });

  const authorizeUsbPort = useCallback(async () => {
    if (!active) return false;
    serial.clearError?.();
    try {
      if (isAndroidSerialAvailable()) {
        await serial.reconnect?.();
        return true;
      }
      await serial.selectPort();
      const info = serial.getPortInfo();
      if (info && updateSerialSettings) {
        updateSerialSettings({
          enabled: true,
          portLocked: true,
          savedPortInfo: info,
        });
      }
      return Boolean(info);
    } catch (err) {
      if (err?.name !== 'NotFoundError') {
        const msg = serial.describeError?.(err) ?? err?.message ?? 'Could not open serial port';
        serial.setError?.(msg);
      }
      return false;
    }
  }, [active, serial, updateSerialSettings]);

  useEffect(() => {
    if (!active || !updateSerialRuntime) return;
    updateSerialRuntime({
      status: serial.status,
      portLabel: serial.portLabel,
      lastLine: serial.lastLine,
      error: serial.error || '',
      isConnected: serial.isConnected,
    });
  }, [
    active,
    updateSerialRuntime,
    serial.status,
    serial.portLabel,
    serial.lastLine,
    serial.error,
    serial.isConnected,
  ]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => {
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serialRuntime: {
            status: serial.status,
            portLabel: serial.portLabel,
            lastLine: serial.lastLine,
            error: serial.error || '',
            isConnected: serial.isConnected,
            at: Date.now(),
          },
        }),
      }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    active,
    serial.status,
    serial.portLabel,
    serial.lastLine,
    serial.error,
    serial.isConnected,
  ]);

  return {
    serial,
    serialSupported: active,
    authorizeUsbPort,
    needsUsbAuthorize:
      active &&
      isWebSerialSupported() &&
      !isAndroidSerialAvailable() &&
      Boolean(serialSettings.enabled) &&
      !serial.isConnected &&
      !serialSettings.savedPortInfo,
  };
}
