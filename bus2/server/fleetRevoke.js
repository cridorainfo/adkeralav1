/** Consecutive invalid-token responses before the PC drops its fleet claim. */
export const REVOKE_STRIKES_REQUIRED = 3;

/** True only when the cloud explicitly rejected this device's bus token (revoke/delete). */
export function isFleetRevoked(result) {
  if (!result || result.ok) return false;
  if (result.status !== 401) return false;
  if (result.json?.revoked === true) return true;
  const err = String(result.json?.error ?? '').toLowerCase();
  return err.includes('invalid bus token');
}
