-- ============================================
-- TOURNAMENT SYSTEM - Part 3: Functions
-- ============================================

-- Get tournament type for a week number
CREATE OR REPLACE FUNCTION get_tournament_type_for_week(week_num INT)
RETURNS TEXT AS $$
DECLARE
  types TEXT[] := ARRAY['wealth_sprint', 'territory_conqueror', 'master_gatherer', 'trade_baron', 'forum_champion'];
  idx INT;
BEGIN
  idx := ((week_num - 1) % 5) + 1;
  RETURN types[idx];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get tournament display name
CREATE OR REPLACE FUNCTION get_tournament_name(t_type TEXT, week_num INT)
RETURNS TEXT AS $$
DECLARE
  type_names TEXT[];
  type_idx INT;
  occurrence INT;
BEGIN
  type_names := ARRAY['Wealth Sprint', 'Territory Conqueror', 'Master Gatherer', 'Trade Baron', 'Forum Champion'];
  
  CASE t_type
    WHEN 'wealth_sprint' THEN type_idx := 1;
    WHEN 'territory_conqueror' THEN type_idx := 2;
    WHEN 'master_gatherer' THEN type_idx := 3;
    WHEN 'trade_baron' THEN type_idx := 4;
    WHEN 'forum_champion' THEN type_idx := 5;
    ELSE type_idx := 1;
  END CASE;
  
  occurrence := ((week_num - type_idx) / 5) + 1;
  RETURN type_names[type_idx] || ' #' || occurrence;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate score for an agent
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
  
  SELECT 
    (gold + wood * 2 + stone * 3 + food),
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

-- Update all scores for a tournament
CREATE OR REPLACE FUNCTION update_tournament_scores(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  entry RECORD;
BEGIN
  FOR entry IN SELECT agent_id FROM tournament_entries WHERE tournament_id = p_tournament_id
  LOOP
    PERFORM calculate_tournament_score(p_tournament_id, entry.agent_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;
