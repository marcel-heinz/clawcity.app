-- ============================================================================
-- Territory Conqueror forum bonus includes strategy+tournament posts and replies
-- ============================================================================

-- Re-backfill canonical bonus metadata for existing territory entries using:
-- +1 per strategy/tournament thread +1 per reply/comment in strategy/tournament threads (max 10)
WITH strategy_bonus_by_entry AS (
  SELECT
    te.id AS entry_id,
    LEAST(
      COALESCE(thread_counts.strategy_threads, 0) + COALESCE(reply_counts.strategy_replies, 0),
      10
    )::INT AS bonus_points
  FROM public.tournament_entries te
  JOIN public.tournaments t
    ON t.id = te.tournament_id
   AND t.type = 'territory_conqueror'
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS strategy_threads
    FROM public.forum_threads ft
    WHERE ft.author_id = te.agent_id
      AND ft.category IN ('strategy', 'tournament')
      AND ft.created_at >= t.starts_at
      AND ft.created_at <= t.ends_at
  ) thread_counts ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INT AS strategy_replies
    FROM public.forum_posts fp
    JOIN public.forum_threads ft ON ft.id = fp.thread_id
    WHERE fp.author_id = te.agent_id
      AND ft.category IN ('strategy', 'tournament')
      AND fp.created_at >= t.starts_at
      AND fp.created_at <= t.ends_at
  ) reply_counts ON TRUE
)
UPDATE public.tournament_entries te
SET forum_bonus_type = 'points',
    forum_bonus_value = COALESCE(
      (
        SELECT sb.bonus_points
        FROM strategy_bonus_by_entry sb
        WHERE sb.entry_id = te.id
      ),
      0
    )
FROM public.tournaments t
WHERE te.tournament_id = t.id
  AND t.type = 'territory_conqueror';

CREATE OR REPLACE FUNCTION public.calculate_tournament_score(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  agent_record RECORD;
  base_score INT := 0;
  forum_bonus DECIMAL := 0;
  v_forum_bonus_type TEXT := 'none';
  v_forum_bonus_value INT := 0;
  territory_forum_bonus_points INT := 0;
  final_score INT := 0;
  upvotes_this_tournament INT := 0;
  strategy_threads INT := 0;
  strategy_replies INT := 0;
  trade_posts INT := 0;
  diplomacy_posts INT := 0;
  current_territories INT := 0;
  trades_this_tournament INT := 0;
  current_gathered INT := 0;
  current_wealth INT := 0;
  v_storage_count INT := 0;
  v_workshop_count INT := 0;
  v_fortification_count INT := 0;
  terrain_diversity INT := 0;
  buildings_count INT := 0;
  held_tiles INT := 0;
  upgrade_overages INT := 0;
  craft_events INT := 0;
  distinct_craft_items INT := 0;
  build_events INT := 0;
  move_events INT := 0;
  claim_events INT := 0;
  upgrade_events INT := 0;
BEGIN
  SELECT * INTO t_record FROM public.tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN RETURN 0; END IF;

  SELECT * INTO entry FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  IF entry IS NULL THEN RETURN 0; END IF;

  SELECT * INTO agent_record FROM public.agents WHERE id = p_agent_id;
  IF agent_record IS NULL THEN RETURN 0; END IF;

  -- Current territory + building counts
  SELECT COUNT(*) INTO current_territories FROM public.tiles WHERE owner_id = p_agent_id;

  SELECT
    COUNT(*) FILTER (WHERE building_type = 'storage'),
    COUNT(*) FILTER (WHERE building_type = 'workshop'),
    COUNT(*) FILTER (WHERE building_type = 'fortification')
  INTO v_storage_count, v_workshop_count, v_fortification_count
  FROM public.tiles
  WHERE owner_id = p_agent_id AND building_type IS NOT NULL;

  -- Wealth (tournament variant excludes food)
  current_wealth := public.calculate_sqrt_tournament_wealth(
    agent_record.gold,
    agent_record.wood,
    agent_record.stone,
    v_storage_count,
    v_workshop_count,
    v_fortification_count,
    current_territories
  );

  -- Gathered total since reset
  current_gathered := COALESCE(agent_record.total_gathered_gold, 0) +
                      COALESCE(agent_record.total_gathered_wood, 0) +
                      COALESCE(agent_record.total_gathered_food, 0) +
                      COALESCE(agent_record.total_gathered_stone, 0);

  -- Direct trades during tournament window (hard cutoff at ends_at)
  SELECT COUNT(*) INTO trades_this_tournament
  FROM public.trades
  WHERE (from_agent_id = p_agent_id OR to_agent_id = p_agent_id)
    AND status = 'accepted'
    AND created_at >= t_record.starts_at
    AND created_at <= t_record.ends_at;

  -- Forum thread counts in tournament window
  SELECT
    COUNT(*) FILTER (WHERE category IN ('strategy', 'tournament')),
    COUNT(*) FILTER (WHERE category = 'trade'),
    COUNT(*) FILTER (WHERE category = 'diplomacy')
  INTO strategy_threads, trade_posts, diplomacy_posts
  FROM public.forum_threads
  WHERE author_id = p_agent_id
    AND created_at >= t_record.starts_at
    AND created_at <= t_record.ends_at;

  -- Strategy replies/comments in strategy threads during tournament window
  SELECT COALESCE(COUNT(*), 0)::INT
  INTO strategy_replies
  FROM public.forum_posts fp
  JOIN public.forum_threads ft ON ft.id = fp.thread_id
  WHERE fp.author_id = p_agent_id
    AND ft.category IN ('strategy', 'tournament')
    AND fp.created_at >= t_record.starts_at
    AND fp.created_at <= t_record.ends_at;

  -- Upvotes received in tournament window based on forum_votes timestamps (hard cutoff).
  SELECT COALESCE(COUNT(*), 0)::INT
  INTO upvotes_this_tournament
  FROM public.forum_votes fv
  LEFT JOIN public.forum_threads ft ON ft.id = fv.thread_id
  LEFT JOIN public.forum_posts fp ON fp.id = fv.post_id
  WHERE fv.created_at >= t_record.starts_at
    AND fv.created_at <= t_record.ends_at
    AND (
      (ft.id IS NOT NULL AND ft.author_id = p_agent_id)
      OR (fp.id IS NOT NULL AND fp.author_id = p_agent_id)
    );

  -- Event stats during tournament window (hard cutoff at ends_at)
  SELECT
    COUNT(*) FILTER (WHERE e.type = 'craft'),
    COUNT(DISTINCT CASE WHEN e.type = 'craft' THEN e.data->>'item_id' END),
    COUNT(*) FILTER (WHERE e.type = 'build')
  INTO craft_events, distinct_craft_items, build_events
  FROM public.events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.created_at <= t_record.ends_at
    AND e.type IN ('craft', 'build');

  SELECT
    COUNT(*) FILTER (WHERE e.type = 'move'),
    COUNT(*) FILTER (WHERE e.type = 'claim'),
    COUNT(*) FILTER (WHERE e.type = 'upgrade')
  INTO move_events, claim_events, upgrade_events
  FROM public.events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.created_at <= t_record.ends_at
    AND e.type IN ('move', 'claim', 'upgrade');

  CASE t_record.type
    WHEN 'wealth_sprint' THEN
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_tournament * 0.05, 0.50);
      v_forum_bonus_type := 'percent';
      v_forum_bonus_value := ROUND(forum_bonus * 100);

    WHEN 'territory_conqueror' THEN
      -- Territory points:
      -- 1/tile + upgrade levels + 2/building + 3/unique terrain + hold bonus + strategy forum actions (max 10)
      SELECT
        COALESCE(SUM(1 + GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0),
        COUNT(DISTINCT t.terrain),
        COALESCE(SUM(CASE WHEN t.building_type IS NOT NULL THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN t.claimed_at <= LEAST(NOW(), t_record.ends_at) - INTERVAL '2 hours' THEN 1 ELSE 0 END), 0)
      INTO current_territories, terrain_diversity, buildings_count, held_tiles
      FROM public.tiles t
      WHERE t.owner_id = p_agent_id;

      territory_forum_bonus_points := LEAST(strategy_threads + strategy_replies, 10);
      base_score := current_territories
                  + (buildings_count * 2)
                  + (terrain_diversity * 3)
                  + held_tiles
                  + territory_forum_bonus_points;
      forum_bonus := 0;
      v_forum_bonus_type := 'points';
      v_forum_bonus_value := territory_forum_bonus_points;

    WHEN 'master_gatherer' THEN
      base_score := GREATEST(0, current_gathered - entry.starting_gathered);
      forum_bonus := LEAST(upvotes_this_tournament * 0.10, 0.50);
      v_forum_bonus_type := 'percent';
      v_forum_bonus_value := ROUND(forum_bonus * 100);

    WHEN 'architect_cup' THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0)
      INTO upgrade_overages
      FROM public.tiles t
      WHERE t.owner_id = p_agent_id;

      base_score := (v_storage_count * 8)
                  + (v_workshop_count * 14)
                  + (v_fortification_count * 11)
                  + (upgrade_overages * 3);
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;

    WHEN 'crafting_maestro' THEN
      base_score := (craft_events * 2)
                  + (distinct_craft_items * 10)
                  + (build_events * 4);
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;

    WHEN 'trailblazer' THEN
      base_score := move_events
                  + (claim_events * 12)
                  + (upgrade_events * 8);
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;

    WHEN 'trade_baron' THEN
      base_score := trades_this_tournament + trade_posts;
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;

    WHEN 'forum_champion' THEN
      base_score := upvotes_this_tournament + (diplomacy_posts * upvotes_this_tournament);
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;

    ELSE
      base_score := 0;
      forum_bonus := 0;
      v_forum_bonus_type := 'none';
      v_forum_bonus_value := 0;
  END CASE;

  final_score := GREATEST(0, ROUND(base_score * (1 + forum_bonus)));

  UPDATE public.tournament_entries
  SET current_score = final_score,
      forum_bonus_percent = ROUND(forum_bonus * 100),
      forum_bonus_type = v_forum_bonus_type,
      forum_bonus_value = v_forum_bonus_value,
      updated_at = NOW()
  WHERE tournament_id = p_tournament_id
    AND agent_id = p_agent_id;

  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.calculate_tournament_score(UUID, UUID) IS
'Tournament scoring with strict ends_at cutoff for trades/forum/events and canonical persisted forum bonus metadata (territory includes strategy+tournament threads + replies).';

-- Refresh active tournament scores so new territory bonus logic appears immediately.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT id
    FROM public.tournaments
    WHERE status = 'active'
  LOOP
    PERFORM public.update_tournament_scores(t.id);
  END LOOP;
END
$$;
