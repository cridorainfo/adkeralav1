const TOKEN_KEY = 'adkerala-driver-token';
const BUS_KEY = 'adkerala-driver-bus';
const PLATE_KEY = 'adkerala-driver-plate';

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

/** Current bus PC origin — switching buses requires re-unlock. */
export function currentBusOrigin() {
  return window.location.origin;
}

export function getStoredDriverToken() {
  const token = read(TOKEN_KEY);
  const bus = read(BUS_KEY);
  if (!token || !bus) return null;
  if (bus !== currentBusOrigin()) {
    clearDriverCredentials();
    return null;
  }
  return token;
}

export function getStoredDriverPlate() {
  return read(PLATE_KEY) ?? '';
}

export function saveDriverCredentials({ token, plate }) {
  write(TOKEN_KEY, token);
  write(BUS_KEY, currentBusOrigin());
  if (plate) write(PLATE_KEY, plate);
}

export function clearDriverCredentials() {
  write(TOKEN_KEY, null);
  write(BUS_KEY, null);
  write(PLATE_KEY, null);
}

export { TOKEN_KEY as DRIVER_TOKEN_KEY };
