-- Micro-Events System
-- Time-limited, location-based bonuses that spawn randomly to create dynamic gameplay

CREATE TABLE IF NOT EXISTS micro_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Event identification
  type TEXT NOT NULL CHECK (type IN (
    'resource_boost',    -- +X% to specific resource(s)
    'terrain_bonus',     -- +X% to specific terrain type(s)
    'global_bonus',      -- World-wide effect
    'danger_zone',       -- Negative effect (storm, etc.)
    'rare_spawn'         -- One-time high-value opportunity
  )),

  -- Display
  title TEXT NOT NULL,
  description TEXT NOT NULL,

  -- Location (NULL = global)
  location_x INT,        -- Center X coordinate (NULL for global)
  location_y INT,        -- Center Y coordinate (NULL for global)
  radius INT,            -- Effect radius in tiles (NULL for single tile or global)

  -- Bonus configuration
  bonus_type TEXT NOT NULL DEFAULT 'gather' CHECK (bonus_type IN ('gather', 'movement', 'claim')),
  bonus_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,  -- 1.25 = +25%, 0.75 = -25%
  affected_resources TEXT[],    -- NULL = all resources, or specific: {'wood', 'gold'}
  affected_terrains TEXT[],     -- NULL = all terrains, or specific: {'forest', 'mountain'}

  -- Timing
  active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,

  -- Limits (for rare spawns)
  max_activations INT,          -- NULL = unlimited
  activation_count INT DEFAULT 0,

  -- State
  active BOOLEAN DEFAULT TRUE,
  announced BOOLEAN DEFAULT FALSE,  -- Has forum announcement been posted?

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_micro_events_active ON micro_events(active, expires_at DESC);
CREATE INDEX idx_micro_events_location ON micro_events(location_x, location_y) WHERE active = TRUE;
CREATE INDEX idx_micro_events_type ON micro_events(type) WHERE active = TRUE;
CREATE INDEX idx_micro_events_expires ON micro_events(expires_at) WHERE active = TRUE;

-- Enable RLS
ALTER TABLE micro_events ENABLE ROW LEVEL SECURITY;

-- Public read access (events are visible to all)
CREATE POLICY "Allow anonymous read access to micro_events" ON micro_events
  FOR SELECT USING (true);

-- Service role full access for cron operations
CREATE POLICY "Service role full access to micro_events"
  ON micro_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_micro_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS trigger_update_micro_events_updated_at ON micro_events;
CREATE TRIGGER trigger_update_micro_events_updated_at
  BEFORE UPDATE ON micro_events
  FOR EACH ROW
  EXECUTE FUNCTION update_micro_events_updated_at();

-- Add to realtime publication for live updates
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE micro_events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
