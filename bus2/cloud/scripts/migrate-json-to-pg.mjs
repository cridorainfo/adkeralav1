#!/usr/bin/env node
/**
 * One-time migration: cloud/data/store.json → PostgreSQL
 * Usage: DATABASE_URL=postgres://... node cloud/scripts/migrate-json-to-pg.mjs
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations, query, closePool, usePostgres } from '../db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'store.json');

async function main() {
  if (!usePostgres()) {
    console.error('Set DATABASE_URL to migrate');
    process.exit(1);
  }

  await runMigrations();
  const raw = await fs.readFile(STORE_FILE, 'utf8');
  const store = JSON.parse(raw);

  for (const [id, user] of Object.entries(store.users ?? {})) {
    await query(
      `INSERT INTO users (id, email, password_hash, name, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [id, user.email, user.passwordHash, user.name, user.role, user.status, user.createdAt]
    );
  }

  for (const [busId, profile] of Object.entries(store.busProfiles ?? {})) {
    await query(
      `INSERT INTO bus_profiles (bus_id, plate, plate_display, pairing_code, linked_driver_id, linked_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (bus_id) DO NOTHING`,
      [
        busId,
        profile.plate ?? '',
        profile.plateDisplay ?? '',
        profile.pairingCode ?? '',
        profile.linkedDriverId,
        profile.linkedAt,
        profile.ownerId,
      ]
    );
  }

  for (const [busId, row] of Object.entries(store.buses ?? {})) {
    await query(
      `INSERT INTO bus_telemetry (bus_id, telemetry, state, display_snapshot, updated_at, full_state_at)
       VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (bus_id) DO UPDATE SET
         telemetry = EXCLUDED.telemetry, state = EXCLUDED.state,
         display_snapshot = EXCLUDED.display_snapshot, updated_at = EXCLUDED.updated_at`,
      [
        busId,
        JSON.stringify(row.telemetry ?? {}),
        JSON.stringify(row.state ?? {}),
        row.displaySnapshot ? JSON.stringify(row.displaySnapshot) : null,
        row.updatedAt ?? Date.now(),
      ]
    );
  }

  for (const route of store.routeCatalog ?? []) {
    await query(
      `INSERT INTO routes (id, owner_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [route.id, route.ownerId ?? null, JSON.stringify(route)]
    );
  }

  for (const stop of store.stopCatalog ?? []) {
    if (!stop?.en) continue;
    await query(
      `INSERT INTO stop_catalog (en, data) VALUES ($1, $2) ON CONFLICT (en) DO NOTHING`,
      [stop.en, JSON.stringify(stop)]
    );
  }

  if (store.releases) {
    await query(
      `INSERT INTO platform_settings (key, value) VALUES ('releases', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(store.releases)]
    );
  }

  console.log('Migration complete.');
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
