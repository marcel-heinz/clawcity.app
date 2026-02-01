-- Migration: Tournament Wealth Sprint Fix
-- Excludes food from Wealth Sprint tournament calculations
-- 
-- REASONING: Food is now an operational resource (stamina/upkeep) not wealth storage.
-- Active players who gather, claim, and maintain territories consume more food,
-- which would unfairly penalize them in wealth competitions.
--
-- This change affects ONLY the Wealth Sprint tournament type.
-- The main game leaderboard continues to use the full wealth formula (gold + wood*2 + stone*3 + food).

-- ============================================
-- UPDATE TOURNAMENT SCORE CALCULATION
-- ============================================

CREATE OR REPLACE FUNCTION calculate_tournament_score(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
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
  
  -- Calculate wealth WITHOUT food for tournaments
  -- Food is operational (stamina/upkeep), not wealth storage
  -- Main leaderboard still uses full wealth formula
  SELECT 
    (gold + wood * 2 + stone * 3),  -- Excludes food for tournament wealth
    COALESCE(total_gathered_gold, 0) + COALESCE(total_gathered_wood, 0) + 
    COALESCE(total_gathered_food, 0) + COALESCE(total_gathered_stone, 0)
  INTO current_wealth, current_gathered
  FROM agents WHERE id = p_agent_id;
  
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
      -- Wealth Sprint: score based on wealth gain (excluding food)
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

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON FUNCTION calculate_tournament_score(UUID, UUID) IS 
'Calculate tournament score for an agent. 
Wealth Sprint uses wealth WITHOUT food (gold + wood*2 + stone*3) because food is operational (stamina/upkeep).
Main game leaderboard still uses full wealth formula including food.';
