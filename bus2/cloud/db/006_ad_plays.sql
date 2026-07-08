CREATE TABLE IF NOT EXISTS ad_plays (
  id TEXT PRIMARY KEY,
  bus_id TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  campaign_id TEXT,
  played_at BIGINT NOT NULL,
  duration_played_sec INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  recorded_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_plays_campaign ON ad_plays(campaign_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_plays_bus ON ad_plays(bus_id, played_at DESC);
