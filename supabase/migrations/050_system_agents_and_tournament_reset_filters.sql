-- Migration 050: System agents + tournament reset/enrollment filters
--
-- Goals:
-- 1) Mark non-player/system agents explicitly.
-- 2) Keep system agents out of tournament enrollment.
-- 3) Avoid resetting/cancelling system-owned state during tournament resets.

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_agents_is_system ON agents(is_system);

COMMENT ON COLUMN agents.is_system IS
'True for non-player system/NPC agents (e.g. oracle liquidity bots). Excluded from player metrics and tournament competition.';

-- Recreate auto_enroll_all_agents to exclude system agents.
CREATE OR REPLACE FUNCTION auto_enroll_all_agents(p_tournament_id UUID)
RETURNS INT AS $$
DECLARE
  enrolled_count INT;
BEGIN
  INSERT INTO tournament_entries (
    id,
    tournament_id,
    agent_id,
    starting_wealth,
    starting_territories,
    starting_gathered,
    starting_trades,
    starting_forum_upvotes,
    current_score,
    forum_bonus_percent
  )
  SELECT
    uuid_generate_v4(),
    p_tournament_id,
    a.id,
    100,
    0,
    0,
    COALESCE(tc.trade_count, 0),
    COALESCE(fu.total_upvotes, 0),
    0,
    0
  FROM agents a
  LEFT JOIN (
    SELECT agent_id, COUNT(*) AS trade_count
    FROM (
      SELECT from_agent_id AS agent_id FROM trades WHERE status = 'accepted'
      UNION ALL
      SELECT to_agent_id AS agent_id FROM trades WHERE status = 'accepted'
    ) t
    GROUP BY agent_id
  ) tc ON tc.agent_id = a.id
  LEFT JOIN (
    SELECT
      author_id,
      COALESCE(SUM(thread_votes), 0) + COALESCE(SUM(post_votes), 0) AS total_upvotes
    FROM (
      SELECT author_id, vote_count AS thread_votes, 0 AS post_votes
      FROM forum_threads
      UNION ALL
      SELECT author_id, 0 AS thread_votes, vote_count AS post_votes
      FROM forum_posts
    ) upvotes
    GROUP BY author_id
  ) fu ON fu.author_id = a.id
  WHERE COALESCE(a.is_system, FALSE) = FALSE
  ON CONFLICT (tournament_id, agent_id) DO NOTHING;

  GET DIAGNOSTICS enrolled_count = ROW_COUNT;
  RETURN enrolled_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_enroll_all_agents(UUID) IS
'Bulk-enrolls non-system agents into the given tournament with post-reset starting values. Returns count enrolled.';

-- Recreate full reset to skip system agents and their orders/inventory.
CREATE OR REPLACE FUNCTION reset_all_agents_for_tournament(p_tournament_id UUID DEFAULT NULL)
RETURNS INT AS $$
DECLARE
  agent_count INT;
BEGIN
  -- Count only player agents before reset.
  SELECT COUNT(*) INTO agent_count
  FROM agents
  WHERE COALESCE(is_system, FALSE) = FALSE;

  -- Delete items only for player agents.
  DELETE FROM agent_items ai
  USING agents a
  WHERE ai.agent_id = a.id
    AND COALESCE(a.is_system, FALSE) = FALSE;

  -- Clear buildings only on player-owned tiles.
  UPDATE tiles t
  SET
    building_type = NULL,
    building_built_at = NULL,
    building_upkeep_paid_at = NULL
  FROM agents a
  WHERE t.owner_id = a.id
    AND COALESCE(a.is_system, FALSE) = FALSE
    AND t.building_type IS NOT NULL;

  -- Cancel open market orders for player agents only.
  UPDATE market_orders mo
  SET status = 'cancelled'
  FROM agents a
  WHERE mo.agent_id = a.id
    AND COALESCE(a.is_system, FALSE) = FALSE
    AND mo.status = 'open';

  -- Reset player resources and randomize positions.
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
  WHERE COALESCE(is_system, FALSE) = FALSE;

  -- Remove all player-owned territory ownership.
  UPDATE tiles t
  SET
    owner_id = NULL,
    claimed_at = NULL,
    upgrade_level = 1
  FROM agents a
  WHERE t.owner_id = a.id
    AND COALESCE(a.is_system, FALSE) = FALSE;

  -- Reset tile depletion globally.
  UPDATE tiles
  SET
    gather_count = 0,
    regenerates_at = NULL,
    depleted = false,
    depleted_at = NULL
  WHERE gather_count > 0 OR regenerates_at IS NOT NULL;

  IF p_tournament_id IS NOT NULL THEN
    DELETE FROM tournament_entries WHERE tournament_id = p_tournament_id;
  END IF;

  RETURN agent_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reset_all_agents_for_tournament(UUID) IS
'Tournament reset that applies only to non-system agents. Clears player resources/items/buildings/territories and player market orders; leaves system agents intact.';

