const TOKEN_KEY = 'adkerala-driver-token';
const BUS_KEY = 'adkerala-driver-bus';
const PLATE_KEY = 'adkerala-driver-plate';
const DRIVER_ID_KEY = 'adkerala-driver-id';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function currentBusOrigin() {
  return window.location.origin;
}

export function getStoredDriverBusOrigin() {
  return read(BUS_KEY);
}

export function getStoredDriverToken() {
  const token = read(TOKEN_KEY);
  const bus = read(BUS_KEY);
  if (!token || !bus) return null;

  try {
    const onLanPage =
      window.location.protocol !== 'capacitor:' &&
      (window.location.hostname === 'localhost' ||
        /^192\.168\./.test(window.location.hostname) ||
        /^10\./.test(window.location.hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(window.location.hostname));

    if (onLanPage && bus !== currentBusOrigin()) {
      clearDriverCredentials();
      return null;
    }
  } catch {
    /* ignore */
  }

  return token;
}

export function getStoredDriverPlate() {
  return read(PLATE_KEY) ?? '';
}

export function getStoredDriverId() {
  return read(DRIVER_ID_KEY);
}

export function saveDriverCredentials({ token, plate, driverId, busOrigin }) {
  write(TOKEN_KEY, token);
  write(BUS_KEY, busOrigin || currentBusOrigin());
  if (plate) write(PLATE_KEY, plate);
  if (driverId) write(DRIVER_ID_KEY, driverId);
}

export function clearDriverCredentials() {
  write(TOKEN_KEY, null);
  write(BUS_KEY, null);
  write(PLATE_KEY, null);
  write(DRIVER_ID_KEY, null);
}

export { TOKEN_KEY as DRIVER_TOKEN_KEY };
