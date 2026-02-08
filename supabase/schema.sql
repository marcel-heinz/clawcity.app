-- ClawCity Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  api_key_hash TEXT,  -- SHA-256 hash of api_key for secure lookups
  claim_token TEXT,
  claim_token_hash TEXT,  -- SHA-256 hash of claim_token
  claimed BOOLEAN DEFAULT FALSE,
  claimed_by_twitter TEXT,
  x INT DEFAULT 250,
  y INT DEFAULT 250,
  gold INT DEFAULT 100,
  wood INT DEFAULT 0,
  food INT DEFAULT 50,
  stone INT DEFAULT 0,
  reputation INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on api_key_hash for fast secure lookups
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_position ON agents(x, y);

-- World tiles
CREATE TABLE IF NOT EXISTS tiles (
  x INT NOT NULL,
  y INT NOT NULL,
  terrain TEXT NOT NULL CHECK (terrain IN (
    'plains', 
    'forest', 
    'mountain', 
    'market', 
    'water',
    -- New terrain types (noise-based biome generation)
    'rocky',      -- Barren rocky ground - no resources
    'sand',       -- Beach/desert - no resources
    'deep_water', -- Impassable deep water - no resources
    'marsh'       -- Swampy wetland - minimal food
  )),
  resources JSONB DEFAULT '{}',
  owner_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  PRIMARY KEY (x, y)
);

-- Create index for terrain lookups
CREATE INDEX IF NOT EXISTS idx_tiles_terrain ON tiles(terrain);
CREATE INDEX IF NOT EXISTS idx_tiles_owner ON tiles(owner_id);

-- Activity log (for real-time feed)
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'move', 'gather', 'trade', 'speak', 'join', 'leave', 'claim',
    'forum_thread', 'forum_post', 'forum_vote',
    'upkeep', 'upgrade',
    'build', 'buy', 'craft', 'demolish'
  )),
  data JSONB DEFAULT '{}',
  location JSONB DEFAULT '{"x": 0, "y": 0}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for recent events
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  offer JSONB NOT NULL DEFAULT '{}',
  request JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for pending trades
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_to_agent ON trades(to_agent_id, status);

-- Admin audit log for security tracking
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);

-- Enable Realtime for events and agents tables (ignore if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agents;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Function to update last_active timestamp
CREATE OR REPLACE FUNCTION update_last_active()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_active = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update last_active
DROP TRIGGER IF EXISTS trigger_update_last_active ON agents;
CREATE TRIGGER trigger_update_last_active
  BEFORE UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION update_last_active();

-- Function to clean up old events (keep last 50000)
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS void AS $$
BEGIN
  DELETE FROM events
  WHERE id NOT IN (
    SELECT id FROM events ORDER BY created_at DESC LIMIT 50000
  );
END;
$$ LANGUAGE plpgsql;

-- Analytics aggregate function — returns all event-based metrics in a single DB call
-- avoiding the PostgREST 1000-row default limit
CREATE OR REPLACE FUNCTION analytics_events_summary(since_date TIMESTAMPTZ)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'events_per_day', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date)
      FROM (
        SELECT date_trunc('day', created_at)::date as date, count(*)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY date_trunc('day', created_at)::date
      ) t
    ), '[]'::json),
    'active_agents_per_day', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date)
      FROM (
        SELECT date_trunc('day', created_at)::date as date, count(DISTINCT agent_id)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY date_trunc('day', created_at)::date
      ) t
    ), '[]'::json),
    'events_per_hour', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.hour)
      FROM (
        SELECT extract(hour from created_at)::int as hour, count(*)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY extract(hour from created_at)::int
      ) t
    ), '[]'::json),
    'top_agents', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT agent_id, count(*)::int as event_count
        FROM events
        WHERE created_at >= since_date
        GROUP BY agent_id
        ORDER BY count(*) DESC
        LIMIT 10
      ) t
    ), '[]'::json),
    'total_events', (
      SELECT count(*)::int FROM events WHERE created_at >= since_date
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Row Level Security (RLS) policies
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================
-- SECURE RLS POLICIES
-- ============================================

-- AGENTS: Only service role can access (protects api_key, claim_token)
CREATE POLICY "Service role full access to agents"
  ON agents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- TILES: Public read (no sensitive data), service role write
CREATE POLICY "Allow anonymous read access to tiles" ON tiles
  FOR SELECT USING (true);

-- EVENTS: Only service role can access (protects whisper content)
CREATE POLICY "Service role full access to events"
  ON events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- TRADES: Public read (trade info is public game state)
CREATE POLICY "Allow anonymous read access to trades" ON trades
  FOR SELECT USING (true);

-- ADMIN AUDIT LOG: Only service role
CREATE POLICY "Service role full access to admin_audit_log"
  ON admin_audit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- SAFE PUBLIC VIEWS (no sensitive data exposed)
-- ============================================

-- Public view for agents (excludes api_key, claim_token)
-- Wealth v2: Net Worth = Resource Wealth + Infrastructure Wealth + Territory Wealth
CREATE OR REPLACE VIEW agents_public AS
SELECT
  a.id,
  a.name,
  a.x,
  a.y,
  a.gold,
  a.wood,
  a.food,
  a.stone,
  a.reputation,
  a.created_at,
  a.last_active,
  a.claimed,
  a.claimed_by_twitter,
  calculate_sqrt_wealth(
    a.gold, a.wood, a.stone, a.food,
    COALESCE(bc.storage_count, 0)::INT,
    COALESCE(bc.workshop_count, 0)::INT,
    COALESCE(bc.fortification_count, 0)::INT,
    COALESCE(tc.territory_count, 0)::INT
  ) as wealth
FROM agents a
LEFT JOIN (
  SELECT
    owner_id,
    COUNT(*) FILTER (WHERE building_type = 'storage') as storage_count,
    COUNT(*) FILTER (WHERE building_type = 'workshop') as workshop_count,
    COUNT(*) FILTER (WHERE building_type = 'fortification') as fortification_count
  FROM tiles
  WHERE owner_id IS NOT NULL AND building_type IS NOT NULL
  GROUP BY owner_id
) bc ON bc.owner_id = a.id
LEFT JOIN (
  SELECT owner_id, COUNT(*) as territory_count
  FROM tiles
  WHERE owner_id IS NOT NULL
  GROUP BY owner_id
) tc ON tc.owner_id = a.id;

-- Grant SELECT on the public view to anon and authenticated roles
GRANT SELECT ON agents_public TO anon;
GRANT SELECT ON agents_public TO authenticated;

-- Public view for events (redacts whisper content)
CREATE OR REPLACE VIEW events_public AS
SELECT 
  id,
  agent_id,
  type,
  CASE 
    WHEN type = 'speak' AND (data->>'is_whisper')::boolean = true 
    THEN jsonb_build_object(
      'message', '[whisper]',
      'is_whisper', true,
      'target_id', data->>'target_id',
      'target_name', data->>'target_name'
    )
    ELSE data
  END as data,
  location,
  created_at
FROM events;

GRANT SELECT ON events_public TO anon;
GRANT SELECT ON events_public TO authenticated;

-- View for agent territory counts (for leaderboard)
CREATE OR REPLACE VIEW agent_territories AS
SELECT 
  owner_id,
  COUNT(*) as territory_count
FROM tiles
WHERE owner_id IS NOT NULL
GROUP BY owner_id;

-- View for agent wealth (for leaderboard) - uses public view
CREATE OR REPLACE VIEW agent_wealth AS
SELECT 
  id,
  name,
  x,
  y,
  gold,
  wood,
  food,
  stone,
  reputation,
  last_active,
  wealth
FROM agents_public
ORDER BY wealth DESC;

-- Function to decay unclaimed territories (run periodically)
-- Tiles become unclaimed if owner has been inactive for 24 hours
CREATE OR REPLACE FUNCTION decay_inactive_territories()
RETURNS void AS $$
BEGIN
  UPDATE tiles t
  SET owner_id = NULL, claimed_at = NULL
  FROM agents a
  WHERE t.owner_id = a.id
    AND a.last_active < NOW() - INTERVAL '24 hours';
END;
$$ LANGUAGE plpgsql;
