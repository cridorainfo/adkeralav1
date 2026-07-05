import { getBusProfile } from './store.js';

/** Verify driver pairing code for LAN connect (admin-set per bus). */
export async function verifyDriverControlForBus(busId, pairingCode) {
  const profile = await getBusProfile(busId);
  if (!profile) return { ok: false, error: 'Bus not found' };

  const code = String(pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  const expectedCode = String(profile.pairingCode ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);

  if (!expectedCode) {
    return { ok: false, error: 'Admin has not set a pairing code for this bus' };
  }

  if (!code || code !== expectedCode) {
    return { ok: false, error: 'Invalid pairing code for this bus' };
  }

  return {
    ok: true,
    busId,
    plate: profile.plateDisplay || profile.plate || busId,
    ownerId: profile.ownerId || 'platform',
  };
}
