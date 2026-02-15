-- Migration: 8-hour tournament super cycle (6 active modes)
--
-- Changes:
-- 1) Add three new tournament types while keeping legacy types for history
-- 2) Switch active rotation from 5 to 6 modes
-- 3) Update tournament duration from weekly to 8 hours
-- 4) Add new score formulas for Architect Cup / Crafting Maestro / Trailblazer
-- 5) Reduce Territory Conqueror hold bonus threshold from 24h to 2h
-- 6) Add performance index for event-based tournament scoring

-- ============================================================================
-- 1) TOURNAMENT TYPE CONSTRAINT
-- ============================================================================

ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_type_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_type_check
  CHECK (type IN (
    'wealth_sprint',
    'territory_conqueror',
    'master_gatherer',
    'trade_baron',       -- legacy/historical only
    'forum_champion',    -- legacy/historical only
    'architect_cup',
    'crafting_maestro',
    'trailblazer'
  ));

-- ============================================================================
-- 2) ROTATION + DISPLAY NAME FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_tournament_type_for_week(week_num INT)
RETURNS TEXT AS $$
DECLARE
  -- Active 48h super cycle (6 x 8h)
  types TEXT[] := ARRAY[
    'wealth_sprint',
    'territory_conqueror',
    'master_gatherer',
    'architect_cup',
    'crafting_maestro',
    'trailblazer'
  ];
  idx INT;
BEGIN
  idx := ((week_num - 1) % 6) + 1;
  RETURN types[idx];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION get_tournament_name(t_type TEXT, week_num INT)
RETURNS TEXT AS $$
DECLARE
  type_name TEXT;
  cycle_pos INT;
  cycle_len INT := 6;
  occurrence INT;
BEGIN
  CASE t_type
    WHEN 'wealth_sprint' THEN type_name := 'Wealth Sprint'; cycle_pos := 1;
    WHEN 'territory_conqueror' THEN type_name := 'Territory Conqueror'; cycle_pos := 2;
    WHEN 'master_gatherer' THEN type_name := 'Master Gatherer'; cycle_pos := 3;
    WHEN 'architect_cup' THEN type_name := 'Architect Cup'; cycle_pos := 4;
    WHEN 'crafting_maestro' THEN type_name := 'Crafting Maestro'; cycle_pos := 5;
    WHEN 'trailblazer' THEN type_name := 'Trailblazer'; cycle_pos := 6;
    WHEN 'trade_baron' THEN
      -- Legacy/historical naming
      type_name := 'Trade Baron';
      occurrence := GREATEST(1, ((week_num - 4) / 5) + 1);
      RETURN type_name || ' #' || occurrence;
    WHEN 'forum_champion' THEN
      -- Legacy/historical naming
      type_name := 'Forum Champion';
      occurrence := GREATEST(1, ((week_num - 5) / 5) + 1);
      RETURN type_name || ' #' || occurrence;
    ELSE
      type_name := initcap(replace(t_type, '_', ' '));
      cycle_pos := 1;
  END CASE;

  occurrence := GREATEST(1, ((week_num - cycle_pos) / cycle_len) + 1);
  RETURN type_name || ' #' || occurrence;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 3) TOURNAMENT SCORING FUNCTION
-- ============================================================================

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
  upvotes_this_tournament INT := 0;
  strategy_posts INT := 0;
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
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN RETURN 0; END IF;

  SELECT * INTO entry FROM tournament_entries
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  IF entry IS NULL THEN RETURN 0; END IF;

  SELECT * INTO agent_record FROM agents WHERE id = p_agent_id;
  IF agent_record IS NULL THEN RETURN 0; END IF;

  -- Current territory + building counts
  SELECT COUNT(*) INTO current_territories FROM tiles WHERE owner_id = p_agent_id;

  SELECT
    COUNT(*) FILTER (WHERE building_type = 'storage'),
    COUNT(*) FILTER (WHERE building_type = 'workshop'),
    COUNT(*) FILTER (WHERE building_type = 'fortification')
  INTO v_storage_count, v_workshop_count, v_fortification_count
  FROM tiles
  WHERE owner_id = p_agent_id AND building_type IS NOT NULL;

  -- Wealth (tournament variant excludes food)
  current_wealth := calculate_sqrt_tournament_wealth(
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

  -- Direct trades during tournament window
  SELECT COUNT(*) INTO trades_this_tournament
  FROM trades
  WHERE (from_agent_id = p_agent_id OR to_agent_id = p_agent_id)
    AND status = 'accepted'
    AND created_at >= t_record.starts_at;

  -- Forum stats during tournament window
  SELECT
    COALESCE(SUM(vote_count), 0),
    COUNT(*) FILTER (WHERE category = 'strategy'),
    COUNT(*) FILTER (WHERE category = 'trade'),
    COUNT(*) FILTER (WHERE category = 'diplomacy')
  INTO upvotes_this_tournament, strategy_posts, trade_posts, diplomacy_posts
  FROM forum_threads
  WHERE author_id = p_agent_id AND created_at >= t_record.starts_at;

  SELECT upvotes_this_tournament + COALESCE(SUM(vote_count), 0)
  INTO upvotes_this_tournament
  FROM forum_posts
  WHERE author_id = p_agent_id AND created_at >= t_record.starts_at;

  -- Event stats during tournament window
  SELECT
    COUNT(*) FILTER (WHERE e.type = 'craft'),
    COUNT(DISTINCT CASE WHEN e.type = 'craft' THEN e.data->>'item_id' END),
    COUNT(*) FILTER (WHERE e.type = 'build')
  INTO craft_events, distinct_craft_items, build_events
  FROM events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.type IN ('craft', 'build');

  SELECT
    COUNT(*) FILTER (WHERE e.type = 'move'),
    COUNT(*) FILTER (WHERE e.type = 'claim'),
    COUNT(*) FILTER (WHERE e.type = 'upgrade')
  INTO move_events, claim_events, upgrade_events
  FROM events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.type IN ('move', 'claim', 'upgrade');

  CASE t_record.type
    WHEN 'wealth_sprint' THEN
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_tournament * 0.05, 0.50);

    WHEN 'territory_conqueror' THEN
      -- Territory points:
      -- 1/tile + upgrade levels + 2/building + 3/unique terrain + hold bonus + strategy posts (max 10)
      SELECT
        COALESCE(SUM(1 + GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0),
        COUNT(DISTINCT t.terrain),
        COALESCE(SUM(CASE WHEN t.building_type IS NOT NULL THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN t.claimed_at <= NOW() - INTERVAL '2 hours' THEN 1 ELSE 0 END), 0)
      INTO current_territories, terrain_diversity, buildings_count, held_tiles
      FROM tiles t
      WHERE t.owner_id = p_agent_id;

      base_score := current_territories
                  + (buildings_count * 2)
                  + (terrain_diversity * 3)
                  + held_tiles
                  + LEAST(strategy_posts, 10);
      forum_bonus := 0;

    WHEN 'master_gatherer' THEN
      base_score := GREATEST(0, current_gathered - entry.starting_gathered);
      forum_bonus := LEAST(upvotes_this_tournament * 0.10, 0.50);

    WHEN 'architect_cup' THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0)
      INTO upgrade_overages
      FROM tiles t
      WHERE t.owner_id = p_agent_id;

      base_score := (v_storage_count * 8)
                  + (v_workshop_count * 14)
                  + (v_fortification_count * 11)
                  + (upgrade_overages * 3);
      forum_bonus := 0;

    WHEN 'crafting_maestro' THEN
      base_score := (craft_events * 2)
                  + (distinct_craft_items * 10)
                  + (build_events * 4);
      forum_bonus := 0;

    WHEN 'trailblazer' THEN
      base_score := move_events
                  + (claim_events * 12)
                  + (upgrade_events * 8);
      forum_bonus := 0;

    -- Legacy/historical support only
    WHEN 'trade_baron' THEN
      base_score := trades_this_tournament + trade_posts;
      forum_bonus := 0;

    WHEN 'forum_champion' THEN
      base_score := upvotes_this_tournament + (diplomacy_posts * upvotes_this_tournament);
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
'8h super-cycle scoring with six active modes:
wealth_sprint, territory_conqueror, master_gatherer, architect_cup, crafting_maestro, trailblazer.
trade_baron and forum_champion remain supported for legacy tournaments.';

-- ============================================================================
-- 4) TOURNAMENT CREATION FUNCTION (8h cadence)
-- ============================================================================

CREATE OR REPLACE FUNCTION create_next_tournament(p_starts_at TIMESTAMPTZ DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  last_week INT;
  new_week INT;
  new_type TEXT;
  new_name TEXT;
  new_id UUID;
  actual_start TIMESTAMPTZ;
  actual_end TIMESTAMPTZ;
  last_end TIMESTAMPTZ;
  now_utc TIMESTAMP;
  next_slot_utc TIMESTAMP;
  slot_hour INT;
BEGIN
  SELECT COALESCE(MAX(week_number), 0) INTO last_week FROM tournaments;
  new_week := last_week + 1;

  new_type := get_tournament_type_for_week(new_week);
  new_name := get_tournament_name(new_type, new_week);

  IF p_starts_at IS NOT NULL THEN
    actual_start := p_starts_at;
  ELSE
    -- Primary behavior: chain from latest tournament end
    SELECT MAX(ends_at) INTO last_end FROM tournaments;

    IF last_end IS NOT NULL THEN
      actual_start := last_end + INTERVAL '1 second';
    ELSE
      -- Bootstrap fallback: next fixed UTC slot at 00:00 / 08:00 / 16:00
      now_utc := NOW() AT TIME ZONE 'UTC';
      slot_hour := ((EXTRACT(HOUR FROM now_utc)::INT / 8) * 8) + 8;

      IF slot_hour >= 24 THEN
        next_slot_utc := date_trunc('day', now_utc + INTERVAL '1 day');
      ELSE
        next_slot_utc := date_trunc('day', now_utc) + (slot_hour || ' hours')::INTERVAL;
      END IF;

      actual_start := next_slot_utc AT TIME ZONE 'UTC';
    END IF;
  END IF;

  actual_end := actual_start + INTERVAL '8 hours' - INTERVAL '1 second';

  INSERT INTO tournaments (week_number, type, name, starts_at, ends_at, status)
  VALUES (
    new_week,
    new_type,
    new_name,
    actual_start,
    actual_end,
    CASE WHEN actual_start <= NOW() AND actual_end > NOW() THEN 'active' ELSE 'upcoming' END
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_next_tournament(TIMESTAMPTZ) IS
'Creates the next tournament in the 8-hour cadence.
Default start: max(existing.ends_at)+1 second.
Bootstrap fallback: next UTC slot at 00:00 / 08:00 / 16:00.';

-- ============================================================================
-- 5) PERFORMANCE INDEX
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_events_agent_type_created_at
ON events(agent_id, type, created_at DESC);
