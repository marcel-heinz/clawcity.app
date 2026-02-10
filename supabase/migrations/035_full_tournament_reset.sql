-- Migration: Full Tournament Reset
--
-- FIXES: The original reset functions (migration 020) only cleared resources
-- and territory ownership. They missed items, buildings, market orders,
-- agent positions, and tile depletion — giving carryover advantages.
--
-- This migration replaces both functions with comprehensive versions.

-- ============================================
-- RESET SINGLE AGENT FOR TOURNAMENT
-- ============================================
CREATE OR REPLACE FUNCTION reset_agent_for_tournament(p_agent_id UUID)
RETURNS void AS $$
BEGIN
  -- Delete all agent items (tools, equipment, consumables)
  DELETE FROM agent_items WHERE agent_id = p_agent_id;

  -- Clear buildings on tiles this agent owns (before ownership wipe)
  UPDATE tiles SET
    building_type = NULL,
    building_built_at = NULL,
    building_upkeep_paid_at = NULL
  WHERE owner_id = p_agent_id AND building_type IS NOT NULL;

  -- Cancel open market orders
  UPDATE market_orders SET status = 'cancelled'
  WHERE agent_id = p_agent_id AND status = 'open';

  -- Reset agent resources to starting values and randomize position
  UPDATE agents
  SET
    gold = 100,
    wood = 0,
    stone = 0,
    food = 50,
    total_gathered_gold = 0,
    total_gathered_wood = 0,
    total_gathered_food = 0,
    total_gathered_stone = 0,
    x = floor(random() * 500)::int,
    y = floor(random() * 500)::int
  WHERE id = p_agent_id;

  -- Remove all territories owned by this agent
  UPDATE tiles
  SET
    owner_id = NULL,
    owner_name = NULL,
    claimed_at = NULL,
    upgrade_level = 1
  WHERE owner_id = p_agent_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_agent_for_tournament(UUID) IS
'Full reset for a single agent joining a tournament mid-season.
Clears: resources, items, buildings, market orders, territories. Randomizes position.';

-- ============================================
-- RESET ALL AGENTS FOR TOURNAMENT START
-- ============================================
CREATE OR REPLACE FUNCTION reset_all_agents_for_tournament()
RETURNS INT AS $$
DECLARE
  agent_count INT;
BEGIN
  -- Count agents before reset
  SELECT COUNT(*) INTO agent_count FROM agents;

  -- Delete ALL agent items (tools, equipment, consumables)
  DELETE FROM agent_items;

  -- Clear buildings from ALL tiles (catch orphans too)
  UPDATE tiles SET
    building_type = NULL,
    building_built_at = NULL,
    building_upkeep_paid_at = NULL
  WHERE building_type IS NOT NULL;

  -- Cancel all open market orders
  UPDATE market_orders SET status = 'cancelled' WHERE status = 'open';

  -- Reset all agent resources and randomize positions
  UPDATE agents
  SET
    gold = 100,
    wood = 0,
    stone = 0,
    food = 50,
    total_gathered_gold = 0,
    total_gathered_wood = 0,
    total_gathered_food = 0,
    total_gathered_stone = 0,
    x = floor(random() * 500)::int,
    y = floor(random() * 500)::int;

  -- Remove all territory ownership
  UPDATE tiles
  SET
    owner_id = NULL,
    owner_name = NULL,
    claimed_at = NULL,
    upgrade_level = 1
  WHERE owner_id IS NOT NULL;

  -- Reset tile resource depletion so map is fresh
  UPDATE tiles SET
    gather_count = 0,
    regenerates_at = NULL,
    depleted = false,
    depleted_at = NULL
  WHERE gather_count > 0 OR regenerates_at IS NOT NULL;

  RETURN agent_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_all_agents_for_tournament() IS
'Full world reset for tournament start. Clears: resources, items, buildings,
market orders, territories, tile depletion. Randomizes all agent positions.
Returns number of agents reset.';
