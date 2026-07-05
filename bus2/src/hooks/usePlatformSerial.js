import { useSerialPort, isWebSerialSupported } from './useSerialPort';
import { useAndroidSerialBridge, isAndroidSerialAvailable } from './useAndroidSerialBridge';

/** Web Serial on PC, native USB bridge on Android TV — same ESP32 mapping either way. */
export function usePlatformSerial(options) {
  const webSerial = useSerialPort({
    ...options,
    enabled: (options.enabled ?? false) && isWebSerialSupported() && !isAndroidSerialAvailable(),
  });
  const androidSerial = useAndroidSerialBridge({
    enabled: (options.enabled ?? false) && isAndroidSerialAvailable(),
    onValueChange: options.onValueChange,
  });

  if (isAndroidSerialAvailable()) return androidSerial;
  return webSerial;
}

export function isPlatformSerialSupported() {
  return isWebSerialSupported() || isAndroidSerialAvailable();
}
