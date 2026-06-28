import { randomUUID } from 'crypto';
import { loadStore, saveStore, upsertBusProfile } from './store.js';
import { hashPassword, verifyPassword, sanitizeUser, SIGNUP_ROLES } from './auth.js';

export async function bootstrapAdminIfNeeded() {
  const email = process.env.ADKERALA_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADKERALA_BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return null;

  const store = await loadStore();
  if (!store.users) store.users = {};

  const existingAdmin = Object.values(store.users).some((u) => u.role === 'admin');
  if (existingAdmin) return null;

  const id = randomUUID();
  store.users[id] = {
    id,
    email,
    passwordHash: await hashPassword(password),
    name: 'Platform Admin',
    role: 'admin',
    status: 'active',
    createdAt: Date.now(),
  };
  await saveStore();
  console.log(`Bootstrap admin created: ${email}`);
  const { pgUpsertUser } = await import('./usersPg.js');
  await pgUpsertUser(store.users[id]);
  return sanitizeUser(store.users[id]);
}

export async function findUserByEmail(email) {
  const store = await loadStore();
  const normalized = String(email ?? '').trim().toLowerCase();
  for (const user of Object.values(store.users ?? {})) {
    if (user.email === normalized) return user;
  }
  return null;
}

export async function findUserById(id) {
  const store = await loadStore();
  return store.users?.[id] ?? null;
}

export async function createUser({ email, password, name, role }) {
  if (!SIGNUP_ROLES.includes(role)) {
    return { ok: false, error: 'Invalid role for signup' };
  }

  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail || !password || String(password).length < 6) {
    return { ok: false, error: 'Valid email and password (6+ chars) required' };
  }

  if (await findUserByEmail(normalizedEmail)) {
    return { ok: false, error: 'Email already registered' };
  }

  const store = await loadStore();
  if (!store.users) store.users = {};

  const id = randomUUID();
  const user = {
    id,
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    name: String(name ?? '').trim() || normalizedEmail.split('@')[0],
    role,
    status: 'active',
    createdAt: Date.now(),
  };
  store.users[id] = user;
  await saveStore();
  const { pgUpsertUser } = await import('./usersPg.js');
  await pgUpsertUser(user);
  return { ok: true, user: sanitizeUser(user) };
}

export async function authenticateUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user || user.status !== 'active') {
    return { ok: false, error: 'Invalid email or password' };
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: 'Invalid email or password' };
  }
  const { pgUpsertUser } = await import('./usersPg.js');
  await pgUpsertUser(user);
  return { ok: true, user: sanitizeUser(user) };
}

export async function listUsers() {
  const store = await loadStore();
  return Object.values(store.users ?? {}).map(sanitizeUser);
}

export async function updateUser(userId, patch) {
  const store = await loadStore();
  const user = store.users?.[userId];
  if (!user) return { ok: false, error: 'User not found' };

  if (patch.name != null) user.name = String(patch.name).trim();
  if (patch.status != null) user.status = patch.status === 'suspended' ? 'suspended' : 'active';
  if (patch.role != null && ['admin', 'bus_owner', 'driver', 'advertiser'].includes(patch.role)) {
    user.role = patch.role;
  }
  await saveStore();
  return { ok: true, user: sanitizeUser(user) };
}

export async function registerBus({ busId, plate, ownerId }) {
  const id = String(busId ?? '').trim();
  if (!id) return { ok: false, error: 'Bus ID required' };

  const patch = {};
  if (ownerId) patch.ownerId = ownerId;
  if (plate) {
    const normalized = String(plate).replace(/\s+/g, '').toUpperCase();
    patch.plate = normalized;
    patch.plateDisplay = String(plate).trim();
  }

  const profile = await upsertBusProfile(id, patch);
  return { ok: true, busId: id, profile };
}

export async function listOwnedBusIds(userId) {
  const store = await loadStore();
  return Object.entries(store.busProfiles ?? {})
    .filter(([, p]) => p.ownerId === userId)
    .map(([busId]) => busId);
}

export async function linkDriverToUser(driverId, userId) {
  const store = await loadStore();
  if (!store.drivers) store.drivers = {};
  const driver = store.drivers[driverId];
  if (!driver) return { ok: false, error: 'Driver session not found. Pair with a bus first.' };

  const user = store.users?.[userId];
  if (!user || user.role !== 'driver') {
    return { ok: false, error: 'Driver account required' };
  }

  driver.userId = userId;
  await saveStore();
  return { ok: true, driver };
}

export async function getDriverAccountSession(userId) {
  const store = await loadStore();
  const user = store.users?.[userId];
  if (!user || user.role !== 'driver') return { ok: false, error: 'Not a driver account' };

  let linkedBusId = null;
  let driverId = null;
  for (const [id, driver] of Object.entries(store.drivers ?? {})) {
    if (driver.userId === userId) {
      driverId = id;
      linkedBusId = driver.linkedBusId;
      break;
    }
  }

  if (!linkedBusId) {
    for (const [id, driver] of Object.entries(store.drivers ?? {})) {
      if (driver.linkedBusId) {
        const profile = store.busProfiles?.[driver.linkedBusId];
        if (profile?.linkedDriverId === id) {
          driver.userId = userId;
          driverId = id;
          linkedBusId = driver.linkedBusId;
          await saveStore();
          break;
        }
      }
    }
  }

  const profile = linkedBusId ? store.busProfiles?.[linkedBusId] : null;
  const busRow = linkedBusId ? store.buses?.[linkedBusId] : null;

  return {
    ok: true,
    linked: Boolean(linkedBusId),
    driverId,
    busId: linkedBusId,
    profile,
    online: busRow ? Date.now() - busRow.updatedAt < 15000 : false,
    telemetry: busRow?.telemetry ?? null,
  };
}
