ALTER TABLE ad_plays ADD COLUMN IF NOT EXISTS route_id TEXT;
ALTER TABLE ad_plays ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'fullscreen';

CREATE INDEX IF NOT EXISTS idx_ad_plays_route ON ad_plays(route_id);
