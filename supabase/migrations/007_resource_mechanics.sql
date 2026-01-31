-- Migration: Add resource mechanics (depletion + upkeep + gathering stats)
-- This enables tile depletion, territory upkeep costs, and tracks total resources gathered per agent

-- ============================================
-- TILE DEPLETION
-- ============================================

-- Add depletion tracking to tiles
-- Tiles have a random chance to deplete after gathering, and regenerate after 1 hour
ALTER TABLE tiles
ADD COLUMN IF NOT EXISTS depleted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS depleted_at TIMESTAMPTZ;

-- Index for efficient depletion checks
CREATE INDEX IF NOT EXISTS idx_tiles_depleted ON tiles(depleted, depleted_at);

-- ============================================
-- TERRITORY UPKEEP
-- ============================================

-- Add upkeep tracking to tiles
-- Territory owners must pay 5 gold/day per tile or lose ownership immediately
ALTER TABLE tiles
ADD COLUMN IF NOT EXISTS last_upkeep_paid TIMESTAMPTZ;

-- Set default for existing claimed tiles to NOW() to give them a grace start
UPDATE tiles 
SET last_upkeep_paid = COALESCE(claimed_at, NOW()) 
WHERE owner_id IS NOT NULL AND last_upkeep_paid IS NULL;

-- ============================================
-- GATHERING STATISTICS (for Top Gatherers leaderboard)
-- ============================================

-- Track total resources gathered per agent (lifetime stats)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS total_gathered_gold INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_gathered_wood INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_gathered_food INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_gathered_stone INT DEFAULT 0;

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_agents_total_gathered ON agents(
  (total_gathered_gold + total_gathered_wood + total_gathered_food + total_gathered_stone) DESC
);

-- ============================================
-- HELPER FUNCTION: Process territory upkeep
-- ============================================

-- Function to check and process upkeep for an agent's territories
-- Returns the number of territories released due to non-payment
CREATE OR REPLACE FUNCTION process_territory_upkeep(
  p_agent_id UUID,
  p_agent_gold INT,
  p_upkeep_cost_per_day INT DEFAULT 5
)
RETURNS TABLE(
  territories_released INT,
  gold_deducted INT,
  remaining_gold INT
) AS $$
DECLARE
  v_tile RECORD;
  v_days_overdue INT;
  v_upkeep_due INT;
  v_total_deducted INT := 0;
  v_released INT := 0;
  v_current_gold INT := p_agent_gold;
BEGIN
  -- Process each owned tile
  FOR v_tile IN 
    SELECT x, y, last_upkeep_paid 
    FROM tiles 
    WHERE owner_id = p_agent_id
    ORDER BY claimed_at ASC  -- Process oldest territories first
  LOOP
    -- Calculate days since last upkeep (minimum 0)
    v_days_overdue := GREATEST(0, 
      EXTRACT(EPOCH FROM (NOW() - COALESCE(v_tile.last_upkeep_paid, NOW()))) / 86400
    )::INT;
    
    IF v_days_overdue >= 1 THEN
      v_upkeep_due := v_days_overdue * p_upkeep_cost_per_day;
      
      IF v_current_gold >= v_upkeep_due THEN
        -- Pay upkeep
        v_current_gold := v_current_gold - v_upkeep_due;
        v_total_deducted := v_total_deducted + v_upkeep_due;
        
        -- Update tile
        UPDATE tiles 
        SET last_upkeep_paid = NOW() 
        WHERE x = v_tile.x AND y = v_tile.y;
      ELSE
        -- Can't afford - release territory
        UPDATE tiles 
        SET owner_id = NULL, claimed_at = NULL, last_upkeep_paid = NULL 
        WHERE x = v_tile.x AND y = v_tile.y;
        
        v_released := v_released + 1;
      END IF;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_released, v_total_deducted, v_current_gold;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN tiles.depleted IS 'Whether this tile is currently depleted of resources';
COMMENT ON COLUMN tiles.depleted_at IS 'When the tile became depleted (for regeneration calculation)';
COMMENT ON COLUMN tiles.last_upkeep_paid IS 'When upkeep was last paid for this territory';
COMMENT ON COLUMN agents.total_gathered_gold IS 'Lifetime gold gathered by this agent';
COMMENT ON COLUMN agents.total_gathered_wood IS 'Lifetime wood gathered by this agent';
COMMENT ON COLUMN agents.total_gathered_food IS 'Lifetime food gathered by this agent';
COMMENT ON COLUMN agents.total_gathered_stone IS 'Lifetime stone gathered by this agent';
