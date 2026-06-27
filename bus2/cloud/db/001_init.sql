-- AdKerala cloud schema v1

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS bus_profiles (
  bus_id TEXT PRIMARY KEY,
  plate TEXT NOT NULL DEFAULT '',
  plate_display TEXT NOT NULL DEFAULT '',
  pairing_code TEXT NOT NULL DEFAULT '',
  linked_driver_id TEXT,
  linked_at BIGINT,
  owner_id UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_bus_profiles_owner ON bus_profiles(owner_id);

CREATE TABLE IF NOT EXISTS bus_devices (
  install_id UUID PRIMARY KEY,
  bus_id TEXT NOT NULL REFERENCES bus_profiles(bus_id) ON DELETE CASCADE,
  token_hash TEXT,
  pending_token TEXT,
  claimed_at BIGINT,
  revoked_at BIGINT
);

CREATE TABLE IF NOT EXISTS fleet_enrollments (
  install_id UUID PRIMARY KEY,
  fleet_claim_code TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  bus_id TEXT,
  owner_id UUID REFERENCES users(id),
  app_version TEXT,
  updated_at BIGINT NOT NULL,
  claimed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_fleet_enrollments_code ON fleet_enrollments(fleet_claim_code) WHERE NOT claimed;

CREATE TABLE IF NOT EXISTS bus_telemetry (
  bus_id TEXT PRIMARY KEY REFERENCES bus_profiles(bus_id) ON DELETE CASCADE,
  telemetry JSONB NOT NULL DEFAULT '{}',
  state JSONB NOT NULL DEFAULT '{}',
  display_snapshot JSONB,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  route_id TEXT,
  stop_index INT,
  app_version TEXT,
  updated_at BIGINT NOT NULL,
  full_state_at BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bus_telemetry_updated ON bus_telemetry(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bus_telemetry_geo ON bus_telemetry(lat, lng) WHERE lat IS NOT NULL;

CREATE TABLE IF NOT EXISTS bus_commands (
  id UUID PRIMARY KEY,
  bus_id TEXT NOT NULL REFERENCES bus_profiles(bus_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  delivered_at BIGINT,
  acked_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_bus_commands_pending ON bus_commands(bus_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_bus_commands_acked ON bus_commands(acked_at) WHERE status = 'acked';

CREATE TABLE IF NOT EXISTS drivers (
  driver_id TEXT PRIMARY KEY,
  linked_bus_id TEXT,
  linked_at BIGINT,
  user_id UUID REFERENCES users(id),
  app_version TEXT,
  last_seen_at BIGINT
);

CREATE TABLE IF NOT EXISTS routes (
  id TEXT PRIMARY KEY,
  owner_id UUID REFERENCES users(id),
  data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routes_owner ON routes(owner_id);

CREATE TABLE IF NOT EXISTS stop_catalog (
  en TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id UUID PRIMARY KEY,
  data JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS bus_location_history (
  id BIGSERIAL PRIMARY KEY,
  bus_id TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_history_bus ON bus_location_history(bus_id, recorded_at DESC);
