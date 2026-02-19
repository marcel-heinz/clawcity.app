-- Migration: First-claim discount for smoother onboarding
--
-- Goal:
-- - Reduce first claim friction without changing core claim mechanics.
-- - Keep claim atomic and race-safe by applying discount logic inside claim_tile_atomic.

CREATE OR REPLACE FUNCTION claim_tile_atomic(
  p_agent_id UUID,
  p_x INT,
  p_y INT,
  p_base_gold_cost INT,
  p_base_wood_cost INT,
  p_base_stone_cost INT,
  p_base_food_claim_cost INT,
  p_food_stamina_cost INT,
  p_max_territories INT,
  p_territory_upkeep_food INT,
  p_deed_discount_percent INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_agent RECORD;
  v_tile RECORD;
  v_deed RECORD;
  v_deed_available BOOLEAN := FALSE;
  v_discount_multiplier NUMERIC := 1;
  v_effective_gold INT := 0;
  v_effective_wood INT := 0;
  v_effective_stone INT := 0;
  v_effective_food_claim INT := 0;
  v_total_food_cost INT := 0;
  v_territory_count INT := 0;
  v_new_gold INT := 0;
  v_new_wood INT := 0;
  v_new_stone INT := 0;
  v_new_food INT := 0;
  v_missing TEXT[] := ARRAY[]::TEXT[];

  v_first_claim_discount_percent INT := 30;
  v_discount_percent_applied INT := 0;
  v_discount_source TEXT := 'none';
  v_territory_deed_used BOOLEAN := FALSE;
  v_first_claim_discount_used BOOLEAN := FALSE;
BEGIN
  -- Lock agent first for deterministic lock order across action RPCs.
  SELECT id, gold, wood, stone, food
  INTO v_agent
  FROM agents
  WHERE id = p_agent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'agent_not_found');
  END IF;

  -- Lock target tile.
  SELECT x, y, terrain, owner_id
  INTO v_tile
  FROM tiles
  WHERE x = p_x AND y = p_y
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tile_not_found');
  END IF;

  IF v_tile.terrain = 'market' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'market_tile');
  END IF;

  IF v_tile.terrain = 'water' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'water_tile');
  END IF;

  IF v_tile.owner_id IS NOT NULL THEN
    IF v_tile.owner_id = p_agent_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'already_owned');
    END IF;
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'tile_claimed',
      'owner_id', v_tile.owner_id
    );
  END IF;

  SELECT COUNT(*) INTO v_territory_count
  FROM tiles
  WHERE owner_id = p_agent_id;

  IF v_territory_count >= p_max_territories THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'territory_limit',
      'max_territories', p_max_territories
    );
  END IF;

  -- Lock deed row if present; function decides if discount applies.
  SELECT id, quantity, uses_remaining
  INTO v_deed
  FROM agent_items
  WHERE agent_id = p_agent_id
    AND item_id = 'territory_deed'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF FOUND
    AND COALESCE(v_deed.quantity, 0) > 0
    AND (v_deed.uses_remaining IS NULL OR v_deed.uses_remaining > 0)
  THEN
    v_deed_available := TRUE;
  END IF;

  -- Discount priority:
  -- 1) First-claim onboarding discount (-30%)
  -- 2) Territory deed discount (if strictly better than first-claim)
  IF v_territory_count = 0 THEN
    v_discount_percent_applied := v_first_claim_discount_percent;
    v_discount_source := 'first_claim';
    v_first_claim_discount_used := TRUE;
  END IF;

  IF v_deed_available AND p_deed_discount_percent > v_discount_percent_applied THEN
    v_discount_percent_applied := p_deed_discount_percent;
    v_discount_source := 'territory_deed';
    v_first_claim_discount_used := FALSE;
    v_territory_deed_used := TRUE;
  END IF;

  IF v_discount_percent_applied > 0 THEN
    v_discount_multiplier := GREATEST(
      0::NUMERIC,
      (100 - v_discount_percent_applied)::NUMERIC / 100::NUMERIC
    );
  END IF;

  v_effective_gold := FLOOR(p_base_gold_cost * v_discount_multiplier);
  v_effective_wood := FLOOR(p_base_wood_cost * v_discount_multiplier);
  v_effective_stone := FLOOR(p_base_stone_cost * v_discount_multiplier);
  v_effective_food_claim := FLOOR(p_base_food_claim_cost * v_discount_multiplier);
  v_total_food_cost := v_effective_food_claim + p_food_stamina_cost;

  IF v_agent.gold < v_effective_gold THEN
    v_missing := array_append(v_missing, format('gold (need %s, have %s)', v_effective_gold, v_agent.gold));
  END IF;
  IF v_agent.wood < v_effective_wood THEN
    v_missing := array_append(v_missing, format('wood (need %s, have %s)', v_effective_wood, v_agent.wood));
  END IF;
  IF v_agent.stone < v_effective_stone THEN
    v_missing := array_append(v_missing, format('stone (need %s, have %s)', v_effective_stone, v_agent.stone));
  END IF;
  IF v_agent.food < v_total_food_cost THEN
    v_missing := array_append(
      v_missing,
      format(
        'food (need %s [%s claim + %s stamina], have %s)',
        v_total_food_cost,
        v_effective_food_claim,
        p_food_stamina_cost,
        v_agent.food
      )
    );
  END IF;

  IF COALESCE(array_length(v_missing, 1), 0) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'insufficient_resources',
      'missing_resources', to_jsonb(v_missing),
      'cost', jsonb_build_object(
        'gold', v_effective_gold,
        'wood', v_effective_wood,
        'stone', v_effective_stone,
        'food', v_total_food_cost,
        'food_claim_cost', v_effective_food_claim,
        'stamina_cost', p_food_stamina_cost
      ),
      'territory_deed_used', v_territory_deed_used,
      'first_claim_discount_used', v_first_claim_discount_used,
      'discount_percent_applied', v_discount_percent_applied,
      'discount_source', v_discount_source
    );
  END IF;

  v_new_gold := v_agent.gold - v_effective_gold;
  v_new_wood := v_agent.wood - v_effective_wood;
  v_new_stone := v_agent.stone - v_effective_stone;
  v_new_food := v_agent.food - v_total_food_cost;

  UPDATE agents
  SET
    gold = v_new_gold,
    wood = v_new_wood,
    stone = v_new_stone,
    food = v_new_food
  WHERE id = p_agent_id;

  UPDATE tiles
  SET
    owner_id = p_agent_id,
    claimed_at = NOW()
  WHERE x = p_x
    AND y = p_y
    AND owner_id IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tile_claimed');
  END IF;

  IF v_territory_deed_used AND v_deed.id IS NOT NULL THEN
    UPDATE agent_items
    SET uses_remaining = 0, quantity = 0
    WHERE id = v_deed.id;
  END IF;

  INSERT INTO events (agent_id, type, data, location)
  VALUES (
    p_agent_id,
    'claim',
    jsonb_build_object(
      'terrain', v_tile.terrain,
      'cost', jsonb_build_object(
        'gold', v_effective_gold,
        'wood', v_effective_wood,
        'stone', v_effective_stone,
        'food', v_total_food_cost
      ),
      'territory_deed_used', v_territory_deed_used,
      'first_claim_discount_used', v_first_claim_discount_used,
      'discount_percent_applied', v_discount_percent_applied,
      'discount_source', v_discount_source,
      'territory_count', v_territory_count + 1,
      'upkeep_cost_per_hour', p_territory_upkeep_food
    ),
    jsonb_build_object('x', p_x, 'y', p_y)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'terrain', v_tile.terrain,
    'territory_count', v_territory_count + 1,
    'territory_deed_used', v_territory_deed_used,
    'first_claim_discount_used', v_first_claim_discount_used,
    'discount_percent_applied', v_discount_percent_applied,
    'discount_source', v_discount_source,
    'cost', jsonb_build_object(
      'gold', v_effective_gold,
      'wood', v_effective_wood,
      'stone', v_effective_stone,
      'food', v_total_food_cost,
      'food_claim_cost', v_effective_food_claim,
      'stamina_cost', p_food_stamina_cost
    ),
    'inventory', jsonb_build_object(
      'gold', v_new_gold,
      'wood', v_new_wood,
      'stone', v_new_stone,
      'food', v_new_food
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION claim_tile_atomic(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT, INT) IS
'Atomic claim action with first-claim onboarding discount, deed-aware discount, and in-transaction event insert.';

GRANT EXECUTE ON FUNCTION claim_tile_atomic(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION claim_tile_atomic(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT, INT) TO authenticated;
