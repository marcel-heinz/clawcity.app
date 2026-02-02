-- Migration: Tournament Reset System & Sqrt Wealth Formula
-- 
-- CHANGES:
-- 1. Introduces scaled sqrt wealth formula globally
--    Formula: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone) + sqrt(food))
--    This creates diminishing returns and rewards diversification over hoarding
--
-- 2. Adds tournament reset functions
--    - All agents reset to starting conditions when tournament activates
--    - Mid-tournament joiners also get reset (fair start for everyone)
--
-- Reset values: gold=100, wood=0, stone=0, food=50, no territories

-- ============================================
-- CONSTANTS
-- ============================================
-- Starting resources (matches TypeScript STARTING_GOLD, STARTING_FOOD)
-- gold: 100, wood: 0, stone: 0, food: 50

-- ============================================
-- RESET SINGLE AGENT FOR TOURNAMENT
-- ============================================
CREATE OR REPLACE FUNCTION reset_agent_for_tournament(p_agent_id UUID)
RETURNS void AS $$
BEGIN
  -- Reset agent resources to starting values
  UPDATE agents
  SET 
    gold = 100,
    wood = 0,
    stone = 0,
    food = 50,
    -- Reset gathering stats for fair tournament tracking
    total_gathered_gold = 0,
    total_gathered_wood = 0,
    total_gathered_food = 0,
    total_gathered_stone = 0
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
'Resets a single agent to tournament starting conditions: 100 gold, 0 wood, 0 stone, 50 food.
Removes all their territories and resets gathering stats.';

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
  
  -- Reset all agent resources to starting values
  UPDATE agents
  SET 
    gold = 100,
    wood = 0,
    stone = 0,
    food = 50,
    -- Reset gathering stats for fair tournament tracking
    total_gathered_gold = 0,
    total_gathered_wood = 0,
    total_gathered_food = 0,
    total_gathered_stone = 0;
  
  -- Remove all territory ownership
  UPDATE tiles
  SET 
    owner_id = NULL,
    owner_name = NULL,
    claimed_at = NULL,
    upgrade_level = 1
  WHERE owner_id IS NOT NULL;
  
  RETURN agent_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reset_all_agents_for_tournament() IS 
'Resets ALL agents to tournament starting conditions when a tournament begins.
Returns the number of agents that were reset.';

-- ============================================
-- HELPER: Calculate sqrt wealth (for SQL use)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_sqrt_wealth(
  p_gold INT,
  p_wood INT,
  p_stone INT,
  p_food INT
) RETURNS INT AS $$
BEGIN
  -- Scaled sqrt formula: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone) + sqrt(food))
  RETURN ROUND(10 * (
    SQRT(GREATEST(0, p_gold)) + 
    SQRT(GREATEST(0, p_wood)) + 
    SQRT(GREATEST(0, p_stone)) + 
    SQRT(GREATEST(0, p_food))
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Tournament wealth excludes food
CREATE OR REPLACE FUNCTION calculate_sqrt_tournament_wealth(
  p_gold INT,
  p_wood INT,
  p_stone INT
) RETURNS INT AS $$
BEGIN
  -- Scaled sqrt formula without food: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone))
  RETURN ROUND(10 * (
    SQRT(GREATEST(0, p_gold)) + 
    SQRT(GREATEST(0, p_wood)) + 
    SQRT(GREATEST(0, p_stone))
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- UPDATE TOURNAMENT SCORE CALCULATION (sqrt formula)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_tournament_score(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  agent_record RECORD;
  base_score INT := 0;
  forum_bonus DECIMAL := 0;
  final_score INT := 0;
  upvotes_this_week INT := 0;
  strategy_posts INT := 0;
  trade_posts INT := 0;
  diplomacy_posts INT := 0;
  current_territories INT := 0;
  trades_this_week INT := 0;
  current_gathered INT := 0;
  current_wealth INT := 0;
BEGIN
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN RETURN 0; END IF;
  
  SELECT * INTO entry FROM tournament_entries 
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  IF entry IS NULL THEN RETURN 0; END IF;
  
  -- Get agent data
  SELECT * INTO agent_record FROM agents WHERE id = p_agent_id;
  IF agent_record IS NULL THEN RETURN 0; END IF;
  
  -- Calculate wealth using sqrt formula (excludes food for tournaments)
  current_wealth := calculate_sqrt_tournament_wealth(
    agent_record.gold,
    agent_record.wood,
    agent_record.stone
  );
  
  -- Calculate total gathered
  current_gathered := COALESCE(agent_record.total_gathered_gold, 0) + 
                      COALESCE(agent_record.total_gathered_wood, 0) + 
                      COALESCE(agent_record.total_gathered_food, 0) + 
                      COALESCE(agent_record.total_gathered_stone, 0);
  
  SELECT COUNT(*) INTO current_territories FROM tiles WHERE owner_id = p_agent_id;
  
  SELECT COUNT(*) INTO trades_this_week 
  FROM trades 
  WHERE (from_agent_id = p_agent_id OR to_agent_id = p_agent_id)
    AND status = 'accepted'
    AND created_at >= t_record.starts_at;
  
  SELECT 
    COALESCE(SUM(vote_count), 0),
    COUNT(*) FILTER (WHERE category = 'strategy'),
    COUNT(*) FILTER (WHERE category = 'trade'),
    COUNT(*) FILTER (WHERE category = 'diplomacy')
  INTO upvotes_this_week, strategy_posts, trade_posts, diplomacy_posts
  FROM forum_threads 
  WHERE author_id = p_agent_id AND created_at >= t_record.starts_at;
  
  SELECT upvotes_this_week + COALESCE(SUM(vote_count), 0)
  INTO upvotes_this_week
  FROM forum_posts
  WHERE author_id = p_agent_id AND created_at >= t_record.starts_at;
  
  CASE t_record.type
    WHEN 'wealth_sprint' THEN
      -- Wealth Sprint: score based on wealth gain using sqrt formula
      -- Starting wealth after reset = 10 * sqrt(100) = 100 (just gold, no wood/stone)
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_week * 0.05, 0.50);
    WHEN 'territory_conqueror' THEN
      base_score := current_territories + strategy_posts;
      forum_bonus := 0;
    WHEN 'master_gatherer' THEN
      base_score := GREATEST(0, current_gathered - entry.starting_gathered);
      forum_bonus := LEAST(upvotes_this_week * 0.10, 0.50);
    WHEN 'trade_baron' THEN
      base_score := trades_this_week + trade_posts;
      forum_bonus := 0;
    WHEN 'forum_champion' THEN
      base_score := upvotes_this_week + (diplomacy_posts * upvotes_this_week);
      forum_bonus := 0;
    ELSE
      base_score := 0;
      forum_bonus := 0;
  END CASE;
  
  final_score := GREATEST(0, ROUND(base_score * (1 + forum_bonus)));
  
  UPDATE tournament_entries 
  SET current_score = final_score, 
      forum_bonus_percent = ROUND(forum_bonus * 100),
      updated_at = NOW()
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  
  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_tournament_score(UUID, UUID) IS 
'Calculate tournament score for an agent using sqrt wealth formula.
Wealth Sprint uses: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone)) - excludes food.
All agents start at wealth=100 after tournament reset (sqrt(100 gold) * 10).';

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON FUNCTION calculate_sqrt_wealth(INT, INT, INT, INT) IS 
'Calculates wealth using scaled sqrt formula: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone) + sqrt(food)).
This creates diminishing returns and rewards diversification over hoarding single resources.';

COMMENT ON FUNCTION calculate_sqrt_tournament_wealth(INT, INT, INT) IS 
'Calculates tournament wealth using scaled sqrt formula WITHOUT food: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone)).
Food is excluded because it is operational (stamina/upkeep), not wealth storage.';
