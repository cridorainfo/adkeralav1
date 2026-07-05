/** Web Serial support for Electron — console USB on the bus display PC (no COM picker). */

const CONSOLE_VENDOR_IDS = new Set([
  0x303a, // Espressif native USB
  0x10c4, // Silicon Labs CP210x
  0x1a86, // WCH CH340
  0x2341, // Arduino
  0x0403, // FTDI
]);

/** Auto-pick any USB serial port — prefer common console chips, else newest in list. */
function pickSerialPort(portList) {
  if (!portList?.length) return null;
  const known = portList.find((p) => {
    const vid = Number(p.vendorId ?? p.usbVendorId ?? 0);
    return CONSOLE_VENDOR_IDS.has(vid);
  });
  return known ?? portList[portList.length - 1];
}

function setupWebSerial(session) {
  if (!session) return;

  session.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'serial') return true;
    return undefined;
  });

  session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') return true;
    return false;
  });

  session.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    const picked = pickSerialPort(portList);
    callback(picked?.portId ?? '');
  });
}

module.exports = { setupWebSerial };
