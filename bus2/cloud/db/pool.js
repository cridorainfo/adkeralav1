import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pool = null;

export function usePostgres() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!usePostgres()) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false },
      max: Number(process.env.PG_POOL_MAX ?? 20),
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const p = getPool();
  if (!p) throw new Error('PostgreSQL not configured');
  return p.query(text, params);
}

export async function runMigrations() {
  if (!usePostgres()) return;
  await runMigrationsWithRetry();
}

export async function runMigrationsWithRetry({ attempts = 15, delayMs = 2000 } = {}) {
  if (!usePostgres()) return;

  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await runMigrationsOnce();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`Postgres migration attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

async function runMigrationsOnce() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(__dirname))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');
    const { rows } = await p.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
    if (rows.length) continue;

    const sql = await fs.readFile(path.join(__dirname, file), 'utf8');
    await p.query(sql);
    await p.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    console.log(`Migration applied: ${version}`);
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
