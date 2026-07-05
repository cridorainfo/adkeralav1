import { useBusStore } from '../hooks/useBusStore';
import { useKioskUpdateStatus } from '../hooks/useKioskUpdateStatus';
import { isCloudOnline, isUpdateDownloading } from '../lib/displayStatus';

/**
 * Three status dots below the AdKerala logo on the passenger display:
 * console (ESP32) · internet · driver phone.
 */
export default function DisplayStatusDots() {
  const { state } = useBusStore();
  const updateStatus = useKioskUpdateStatus();

  const consoleOn = Boolean(state.serialRuntime?.isConnected);
  const internetOn = isCloudOnline(state.lastCloudPushAt);
  const driverOn = (state.connectedDeviceCount ?? 0) > 0 || Boolean(state.driverLink?.driverId);
  const internetBlink = isUpdateDownloading(updateStatus);

  const dots = [
    { key: 'console', on: consoleOn, blink: false, label: consoleOn ? 'Console connected' : 'Console not connected' },
    {
      key: 'internet',
      on: internetOn,
      blink: internetBlink,
      label: internetBlink
        ? 'Downloading update…'
        : internetOn
          ? 'Internet available'
          : 'No internet',
    },
    { key: 'driver', on: driverOn, blink: false, label: driverOn ? 'Driver connected' : 'Driver not connected' },
  ];

  return (
    <div
      className="display-status-dots"
      role="status"
      aria-label={`Console ${consoleOn ? 'connected' : 'disconnected'}. Internet ${internetOn ? 'available' : 'unavailable'}. Driver ${driverOn ? 'connected' : 'disconnected'}.`}
    >
      {dots.map((dot) => (
        <span
          key={dot.key}
          className={`display-status-dot${dot.on ? ' on' : ''}${dot.blink ? ' blink' : ''}`}
          title={dot.label}
          aria-hidden
        />
      ))}
    </div>
  );
}
