-- Migration: Territory Upgrade System
-- Allows agents to upgrade their territories with wood and stone for better gathering bonuses

-- ============================================
-- TILE UPGRADE LEVEL
-- ============================================

-- Add upgrade level to tiles (1-3, default 1)
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS upgrade_level INT DEFAULT 1;

-- Constraint to ensure upgrade_level is within valid range
ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_upgrade_level_check;
ALTER TABLE tiles ADD CONSTRAINT tiles_upgrade_level_check 
  CHECK (upgrade_level >= 1 AND upgrade_level <= 3);

-- ============================================
-- RESET UPGRADE ON OWNERSHIP CHANGE
-- ============================================

-- Function to reset upgrade level when territory changes hands
CREATE OR REPLACE FUNCTION reset_tile_upgrade()
RETURNS TRIGGER AS $$
BEGIN
  -- Reset upgrade to level 1 when owner changes
  IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
    NEW.upgrade_level := 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to reset upgrade on ownership change
DROP TRIGGER IF EXISTS trigger_reset_tile_upgrade ON tiles;
CREATE TRIGGER trigger_reset_tile_upgrade
  BEFORE UPDATE ON tiles
  FOR EACH ROW
  EXECUTE FUNCTION reset_tile_upgrade();

-- ============================================
-- INDEX FOR UPGRADE QUERIES
-- ============================================

-- Index for finding upgraded territories
CREATE INDEX IF NOT EXISTS idx_tiles_upgrade_level ON tiles(upgrade_level) WHERE upgrade_level > 1;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN tiles.upgrade_level IS 'Territory upgrade level (1-3). Level 1: +25%, Level 2: +50%, Level 3: +75% gathering bonus. Resets to 1 on ownership change.';
