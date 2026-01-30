-- Migration: Add Territory System
-- Run this in Supabase SQL Editor if you already have an existing database

-- 1. Add territory columns to tiles table
ALTER TABLE tiles 
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES agents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- 2. Create index for tile ownership lookups
CREATE INDEX IF NOT EXISTS idx_tiles_owner ON tiles(owner_id);

-- 3. Update events type constraint to include 'claim'
-- First drop the old constraint, then add the new one
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check 
  CHECK (type IN ('move', 'gather', 'trade', 'speak', 'join', 'leave', 'claim'));

-- 4. Function to decay unclaimed territories (run periodically)
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

-- 5. View for agent territory counts (for leaderboard)
CREATE OR REPLACE VIEW agent_territories AS
SELECT 
  owner_id,
  COUNT(*) as territory_count
FROM tiles
WHERE owner_id IS NOT NULL
GROUP BY owner_id;

-- 6. View for agent wealth (for leaderboard)
-- Wealth = gold + (wood * 2) + (stone * 3) + food
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
  (gold + (wood * 2) + (stone * 3) + food) as wealth
FROM agents
ORDER BY wealth DESC;

-- Done!
-- The territory system is now active.
