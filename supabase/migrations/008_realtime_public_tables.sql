-- Migration: Public Realtime Tables
-- Creates sanitized public tables for safe realtime subscriptions
-- Protects api_key, claim_token, and whisper content from exposure

-- ============================================
-- 1. CREATE PUBLIC AGENTS TABLE FOR REALTIME
-- ============================================

-- This table mirrors agents but excludes sensitive columns
CREATE TABLE IF NOT EXISTS agents_realtime (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  x INT DEFAULT 250,
  y INT DEFAULT 250,
  gold INT DEFAULT 100,
  wood INT DEFAULT 0,
  food INT DEFAULT 50,
  stone INT DEFAULT 0,
  reputation INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW(),
  claimed BOOLEAN DEFAULT FALSE,
  claimed_by_twitter TEXT
);

-- Index for position lookups (used by map)
CREATE INDEX IF NOT EXISTS idx_agents_realtime_position ON agents_realtime(x, y);

-- ============================================
-- 2. CREATE PUBLIC EVENTS TABLE FOR REALTIME
-- ============================================

-- This table mirrors events but redacts whisper content
CREATE TABLE IF NOT EXISTS events_realtime (
  id BIGINT PRIMARY KEY,
  agent_id UUID,
  type TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  location JSONB DEFAULT '{"x": 0, "y": 0}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for recent events
CREATE INDEX IF NOT EXISTS idx_events_realtime_created_at ON events_realtime(created_at DESC);

-- ============================================
-- 3. ENABLE RLS WITH PUBLIC READ ACCESS
-- ============================================

ALTER TABLE agents_realtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE events_realtime ENABLE ROW LEVEL SECURITY;

-- Allow anonymous read access (safe - no sensitive data)
CREATE POLICY "Allow anonymous read access to agents_realtime"
  ON agents_realtime
  FOR SELECT
  USING (true);

CREATE POLICY "Allow anonymous read access to events_realtime"
  ON events_realtime
  FOR SELECT
  USING (true);

-- Service role can do everything (for triggers)
CREATE POLICY "Service role full access to agents_realtime"
  ON agents_realtime
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to events_realtime"
  ON events_realtime
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 4. CREATE TRIGGER FUNCTIONS
-- ============================================

-- Function to sync agent changes to public table
CREATE OR REPLACE FUNCTION sync_agent_to_realtime()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO agents_realtime (
      id, name, x, y, gold, wood, food, stone, 
      reputation, created_at, last_active, claimed, claimed_by_twitter
    ) VALUES (
      NEW.id, NEW.name, NEW.x, NEW.y, NEW.gold, NEW.wood, NEW.food, NEW.stone,
      NEW.reputation, NEW.created_at, NEW.last_active, NEW.claimed, NEW.claimed_by_twitter
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      x = EXCLUDED.x,
      y = EXCLUDED.y,
      gold = EXCLUDED.gold,
      wood = EXCLUDED.wood,
      food = EXCLUDED.food,
      stone = EXCLUDED.stone,
      reputation = EXCLUDED.reputation,
      last_active = EXCLUDED.last_active,
      claimed = EXCLUDED.claimed,
      claimed_by_twitter = EXCLUDED.claimed_by_twitter;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM agents_realtime WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to sync event changes to public table (with whisper redaction)
CREATE OR REPLACE FUNCTION sync_event_to_realtime()
RETURNS TRIGGER AS $$
DECLARE
  sanitized_data JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Redact whisper content
    IF NEW.type = 'speak' AND (NEW.data->>'is_whisper')::boolean = true THEN
      sanitized_data := jsonb_build_object(
        'message', '[whisper]',
        'is_whisper', true,
        'target_id', NEW.data->>'target_id',
        'target_name', NEW.data->>'target_name'
      );
    ELSE
      sanitized_data := NEW.data;
    END IF;
    
    INSERT INTO events_realtime (id, agent_id, type, data, location, created_at)
    VALUES (NEW.id, NEW.agent_id, NEW.type, sanitized_data, NEW.location, NEW.created_at);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM events_realtime WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. CREATE TRIGGERS
-- ============================================

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_sync_agent_realtime ON agents;
DROP TRIGGER IF EXISTS trigger_sync_event_realtime ON events;

-- Trigger for agents table
CREATE TRIGGER trigger_sync_agent_realtime
  AFTER INSERT OR UPDATE OR DELETE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION sync_agent_to_realtime();

-- Trigger for events table
CREATE TRIGGER trigger_sync_event_realtime
  AFTER INSERT OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION sync_event_to_realtime();

-- ============================================
-- 6. ADD TABLES TO REALTIME PUBLICATION
-- ============================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE agents_realtime;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE events_realtime;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 7. BACKFILL EXISTING DATA
-- ============================================

-- Copy existing agents (without sensitive columns)
INSERT INTO agents_realtime (
  id, name, x, y, gold, wood, food, stone, 
  reputation, created_at, last_active, claimed, claimed_by_twitter
)
SELECT 
  id, name, x, y, gold, wood, food, stone,
  reputation, created_at, last_active, claimed, claimed_by_twitter
FROM agents
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  x = EXCLUDED.x,
  y = EXCLUDED.y,
  gold = EXCLUDED.gold,
  wood = EXCLUDED.wood,
  food = EXCLUDED.food,
  stone = EXCLUDED.stone,
  reputation = EXCLUDED.reputation,
  last_active = EXCLUDED.last_active,
  claimed = EXCLUDED.claimed,
  claimed_by_twitter = EXCLUDED.claimed_by_twitter;

-- Copy existing events (with whisper redaction)
INSERT INTO events_realtime (id, agent_id, type, data, location, created_at)
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
  END,
  location,
  created_at
FROM events
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 8. CLEANUP FUNCTION FOR OLD REALTIME EVENTS
-- ============================================

-- Function to clean up old events from realtime table (keep last 1000)
CREATE OR REPLACE FUNCTION cleanup_old_realtime_events()
RETURNS void AS $$
BEGIN
  DELETE FROM events_realtime
  WHERE id NOT IN (
    SELECT id FROM events_realtime ORDER BY created_at DESC LIMIT 1000
  );
END;
$$ LANGUAGE plpgsql;

-- Done! Frontend can now safely subscribe to agents_realtime and events_realtime
