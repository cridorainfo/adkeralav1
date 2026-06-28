ALTER TABLE bus_profiles
  ADD COLUMN IF NOT EXISTS assigned_route_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
