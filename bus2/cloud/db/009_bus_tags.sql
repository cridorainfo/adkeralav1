-- Free-text tags per bus (depot, region, vehicle type, etc.) — lets an admin managing a large
-- fleet act on a cohort ("all Kochi depot buses") instead of one flat list of every bus. See the
-- feature-gap audit's finding on this. Stored as a JSON array of strings, same shape as
-- assigned_route_ids already uses on this table.
ALTER TABLE bus_profiles
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
