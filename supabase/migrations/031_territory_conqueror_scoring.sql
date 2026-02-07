-- Migration: Territory Conqueror — Territory Points Scoring
--
-- CHANGES:
-- Replace the old territory_conqueror scoring (tiles_owned + strategy_posts)
-- with a Territory Points system that rewards territorial development quality:
--   Base:             1 point per owned tile
--   Upgrades:         +1 per upgrade level above 1 (level 2 = +1, level 3 = +2)
--   Buildings:        +2 per building on owned territory
--   Terrain diversity:+3 per unique terrain type in territory set
--   Hold bonus:       +1 per tile held 24+ hours continuously
--   Forum:            +1 per strategy post, capped at 10

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
  v_storage_count INT := 0;
  v_workshop_count INT := 0;
  v_fortification_count INT := 0;
  terrain_diversity INT := 0;
  buildings_count INT := 0;
  held_tiles INT := 0;
BEGIN
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN RETURN 0; END IF;

  SELECT * INTO entry FROM tournament_entries
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  IF entry IS NULL THEN RETURN 0; END IF;

  -- Get agent data
  SELECT * INTO agent_record FROM agents WHERE id = p_agent_id;
  IF agent_record IS NULL THEN RETURN 0; END IF;

  -- Count territories and buildings
  SELECT COUNT(*) INTO current_territories FROM tiles WHERE owner_id = p_agent_id;

  SELECT
    COUNT(*) FILTER (WHERE building_type = 'storage'),
    COUNT(*) FILTER (WHERE building_type = 'workshop'),
    COUNT(*) FILTER (WHERE building_type = 'fortification')
  INTO v_storage_count, v_workshop_count, v_fortification_count
  FROM tiles
  WHERE owner_id = p_agent_id AND building_type IS NOT NULL;

  -- Calculate wealth using Net Worth formula (excludes food for tournaments)
  current_wealth := calculate_sqrt_tournament_wealth(
    agent_record.gold,
    agent_record.wood,
    agent_record.stone,
    v_storage_count,
    v_workshop_count,
    v_fortification_count,
    current_territories
  );

  -- Calculate total gathered
  current_gathered := COALESCE(agent_record.total_gathered_gold, 0) +
                      COALESCE(agent_record.total_gathered_wood, 0) +
                      COALESCE(agent_record.total_gathered_food, 0) +
                      COALESCE(agent_record.total_gathered_stone, 0);

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
      -- Wealth Sprint: score based on wealth gain using Net Worth formula
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_week * 0.05, 0.50);
    WHEN 'territory_conqueror' THEN
      -- Territory Points: quality over quantity
      -- Base: 1 per tile
      -- Upgrades: +1 per upgrade level above 1 (level 2 = +1, level 3 = +2)
      -- Buildings: +2 per building on owned territory
      -- Terrain diversity: +3 per unique terrain type in territory set
      -- Hold bonus: +1 per tile held 24+ hours continuously
      -- Forum: +1 per strategy post, capped at 10

      SELECT
        COALESCE(SUM(1 + GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0),
        COUNT(DISTINCT t.terrain),
        COALESCE(SUM(CASE WHEN t.building_type IS NOT NULL THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN t.claimed_at <= NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)
      INTO current_territories, terrain_diversity, buildings_count, held_tiles
      FROM tiles t WHERE t.owner_id = p_agent_id;

      base_score := current_territories                    -- tiles + upgrade levels
                  + (buildings_count * 2)                   -- +2 per building
                  + (terrain_diversity * 3)                 -- +3 per unique terrain
                  + held_tiles                              -- +1 per tile held 24h+
                  + LEAST(strategy_posts, 10);              -- forum capped at 10
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
'Calculate tournament score. Territory Conqueror uses Territory Points:
1pt/tile + upgrade levels + 2pt/building + 3pt/unique terrain + 1pt/tile held 24h+ + strategy posts (max 10).';
