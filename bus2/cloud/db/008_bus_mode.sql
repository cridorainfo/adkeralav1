-- 'route' (default, existing behavior) or 'entertainment' (Schedules feature — plays a looping
-- media playlist instead of route/stop/announcement content; see cloud/schedules.js).
ALTER TABLE bus_profiles
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'route';
