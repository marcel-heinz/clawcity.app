-- Migration: Agent Avatar System
-- Adds per-agent color customization (body, claw, eye colors)
-- Empty {} = use deterministic defaults generated from name hash

-- ============================================
-- 1. ADD AVATAR COLUMN TO AGENTS TABLE
-- ============================================

ALTER TABLE agents ADD COLUMN IF NOT EXISTS avatar JSONB DEFAULT '{}';

-- ============================================
-- 2. ADD AVATAR COLUMN TO AGENTS_REALTIME TABLE
-- ============================================

ALTER TABLE agents_realtime ADD COLUMN IF NOT EXISTS avatar JSONB DEFAULT '{}';

-- ============================================
-- 3. UPDATE SYNC TRIGGER TO INCLUDE AVATAR
-- ============================================

CREATE OR REPLACE FUNCTION sync_agent_to_realtime()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    INSERT INTO agents_realtime (
      id, name, x, y, gold, wood, food, stone,
      reputation, created_at, last_active, claimed, claimed_by_twitter, avatar
    ) VALUES (
      NEW.id, NEW.name, NEW.x, NEW.y, NEW.gold, NEW.wood, NEW.food, NEW.stone,
      NEW.reputation, NEW.created_at, NEW.last_active, NEW.claimed, NEW.claimed_by_twitter, NEW.avatar
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
      claimed_by_twitter = EXCLUDED.claimed_by_twitter,
      avatar = EXCLUDED.avatar;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM agents_realtime WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. BACKFILL AGENTS_REALTIME WITH AVATAR DATA
-- ============================================

UPDATE agents_realtime ar
SET avatar = a.avatar
FROM agents a
WHERE ar.id = a.id AND a.avatar IS NOT NULL AND a.avatar != '{}';
