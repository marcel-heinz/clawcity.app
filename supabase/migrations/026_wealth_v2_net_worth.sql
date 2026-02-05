-- Migration: Wealth v2 — Net Worth System
--
-- CHANGES:
-- Wealth now includes three components:
--   1. Resource Wealth:       10 × (√gold + √wood + √stone + √food)
--   2. Infrastructure Wealth: Storage=90, Workshop=200, Fortification=140 per building
--   3. Territory Wealth:      30 per owned tile
--
-- Buildings valued at ~60% of construction cost (they require ongoing upkeep).
-- Territory valued at ~30% of claim cost.
-- This rewards players who invest in infrastructure rather than just hoarding resources.

-- ============================================
-- WEALTH CONSTANTS (for reference)
-- ============================================
-- WEALTH_SCALE_FACTOR = 10
-- WEALTH_TERRITORY_VALUE = 30
-- WEALTH_BUILDING_VALUES: storage=90, workshop=200, fortification=140

-- ============================================
-- NEW: Calculate wealth v2 (Net Worth)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_sqrt_wealth(
  p_gold INT,
  p_wood INT,
  p_stone INT,
  p_food INT,
  p_storage_count INT DEFAULT 0,
  p_workshop_count INT DEFAULT 0,
  p_fortification_count INT DEFAULT 0,
  p_territory_count INT DEFAULT 0
) RETURNS INT AS $$
BEGIN
  RETURN ROUND(
    -- Resource wealth
    10 * (
      SQRT(GREATEST(0, p_gold)) +
      SQRT(GREATEST(0, p_wood)) +
      SQRT(GREATEST(0, p_stone)) +
      SQRT(GREATEST(0, p_food))
    )
    -- Infrastructure wealth
    + (p_storage_count * 90)
    + (p_workshop_count * 200)
    + (p_fortification_count * 140)
    -- Territory wealth
    + (p_territory_count * 30)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_sqrt_wealth(INT, INT, INT, INT, INT, INT, INT, INT) IS
'Calculates Net Worth wealth: 10×(√gold+√wood+√stone+√food) + building_values + territory×30.
Building values: Storage=90, Workshop=200, Fortification=140. Territory=30 per tile.';

-- ============================================
-- NEW: Calculate tournament wealth v2 (excludes food)
-- ============================================
CREATE OR REPLACE FUNCTION calculate_sqrt_tournament_wealth(
  p_gold INT,
  p_wood INT,
  p_stone INT,
  p_storage_count INT DEFAULT 0,
  p_workshop_count INT DEFAULT 0,
  p_fortification_count INT DEFAULT 0,
  p_territory_count INT DEFAULT 0
) RETURNS INT AS $$
BEGIN
  RETURN ROUND(
    -- Resource wealth (no food)
    10 * (
      SQRT(GREATEST(0, p_gold)) +
      SQRT(GREATEST(0, p_wood)) +
      SQRT(GREATEST(0, p_stone))
    )
    -- Infrastructure wealth
    + (p_storage_count * 90)
    + (p_workshop_count * 200)
    + (p_fortification_count * 140)
    -- Territory wealth
    + (p_territory_count * 30)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_sqrt_tournament_wealth(INT, INT, INT, INT, INT, INT, INT) IS
'Tournament wealth (excludes food): 10×(√gold+√wood+√stone) + building_values + territory×30.
Food excluded because it is operational (stamina/upkeep), not wealth storage.';

-- ============================================
-- UPDATE: agents_public view with Net Worth
-- ============================================
CREATE OR REPLACE VIEW agents_public AS
SELECT
  a.id,
  a.name,
  a.x,
  a.y,
  a.gold,
  a.wood,
  a.food,
  a.stone,
  a.reputation,
  a.created_at,
  a.last_active,
  a.claimed,
  a.claimed_by_twitter,
  calculate_sqrt_wealth(
    a.gold, a.wood, a.stone, a.food,
    COALESCE(bc.storage_count, 0),
    COALESCE(bc.workshop_count, 0),
    COALESCE(bc.fortification_count, 0),
    COALESCE(tc.territory_count, 0)
  ) as wealth
FROM agents a
LEFT JOIN (
  SELECT
    owner_id,
    COUNT(*) FILTER (WHERE building_type = 'storage') as storage_count,
    COUNT(*) FILTER (WHERE building_type = 'workshop') as workshop_count,
    COUNT(*) FILTER (WHERE building_type = 'fortification') as fortification_count
  FROM tiles
  WHERE owner_id IS NOT NULL AND building_type IS NOT NULL
  GROUP BY owner_id
) bc ON bc.owner_id = a.id
LEFT JOIN (
  SELECT owner_id, COUNT(*) as territory_count
  FROM tiles
  WHERE owner_id IS NOT NULL
  GROUP BY owner_id
) tc ON tc.owner_id = a.id;

-- Re-grant permissions
GRANT SELECT ON agents_public TO anon;
GRANT SELECT ON agents_public TO authenticated;

-- ============================================
-- UPDATE: agent_wealth view
-- ============================================
CREATE OR REPLACE VIEW agent_wealth AS
SELECT
  id,
  name,
  x,
  y,
  gold,
  wood,
  food,
  stone,
  reputation,
  last_active,
  wealth
FROM agents_public
ORDER BY wealth DESC;

-- Re-grant permissions
GRANT SELECT ON agent_wealth TO anon;
GRANT SELECT ON agent_wealth TO authenticated;

-- ============================================
-- UPDATE: Tournament score calculation
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
  v_storage_count INT := 0;
  v_workshop_count INT := 0;
  v_fortification_count INT := 0;
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
'Calculate tournament score using Net Worth wealth formula.
Wealth Sprint uses: 10×(√gold+√wood+√stone) + building_values + territory×30 (excludes food).
Building values: Storage=90, Workshop=200, Fortification=140.';
