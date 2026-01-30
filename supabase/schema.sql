-- ClawCity Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
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

-- Create index on api_key for fast lookups
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_position ON agents(x, y);

-- World tiles
CREATE TABLE IF NOT EXISTS tiles (
  x INT NOT NULL,
  y INT NOT NULL,
  terrain TEXT NOT NULL CHECK (terrain IN ('plains', 'forest', 'mountain', 'market', 'water')),
  resources JSONB DEFAULT '{}',
  PRIMARY KEY (x, y)
);

-- Create index for terrain lookups
CREATE INDEX IF NOT EXISTS idx_tiles_terrain ON tiles(terrain);

-- Activity log (for real-time feed)
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('move', 'gather', 'trade', 'speak', 'join', 'leave')),
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

-- Function to clean up old events (keep last 1000)
CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS void AS $$
BEGIN
  DELETE FROM events
  WHERE id NOT IN (
    SELECT id FROM events ORDER BY created_at DESC LIMIT 1000
  );
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) policies
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Allow read access to all tables for anonymous users (observers)
CREATE POLICY "Allow anonymous read access to agents" ON agents
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to tiles" ON tiles
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to events" ON events
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to trades" ON trades
  FOR SELECT USING (true);

-- Service role has full access (handled by API routes)
-- The API routes will use the service role key for writes
