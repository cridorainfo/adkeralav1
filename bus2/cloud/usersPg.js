import { query, usePostgres } from './db/pool.js';

export function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value ?? '')
  );
}

/** Normalize owner id for Postgres FK — non-UUID ids (e.g. legacy API key) become null. */
export function pgOwnerId(ownerId) {
  return isValidUuid(ownerId) ? ownerId : null;
}

export async function pgUpsertUser(user) {
  if (!usePostgres() || !user?.id || !isValidUuid(user.id)) return;
  await query(
    `INSERT INTO users (id, email, password_hash, name, role, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       status = EXCLUDED.status`,
    [
      user.id,
      user.email,
      user.passwordHash,
      user.name,
      user.role,
      user.status ?? 'active',
      user.createdAt ?? Date.now(),
    ]
  );
}

/** Mirror a file-store user into Postgres before FK inserts (claim bus, etc.). */
export async function pgEnsureUser(userId) {
  if (!usePostgres() || !isValidUuid(userId)) return null;
  const { findUserById } = await import('./users.js');
  const user = await findUserById(userId);
  if (!user) return null;
  await pgUpsertUser(user);
  return user.id;
}
