-- Migration 057: DB-backed claim quote RPC
--
-- Goal:
-- - Keep claim affordability previews aligned with atomic claim execution pricing.
-- - Provide a non-mutating quote endpoint for CLI/API planning helpers.

CREATE OR REPLACE FUNCTION quote_claim_tile(
  p_agent_id UUID,
  p_x INT,
  p_y INT,
  p_base_gold_cost INT,
  p_base_wood_cost INT,
  p_base_stone_cost INT,
  p_base_food_claim_cost INT,
  p_food_stamina_cost INT,
  p_max_territories INT,
  p_deed_discount_percent INT DEFAULT 50
) RETURNS JSONB AS $$
DECLARE
  v_agent RECORD;
  v_tile RECORD;
  v_deed RECORD;
  v_deed_available BOOLEAN := FALSE;
  v_territory_count INT := 0;

  v_first_claim_discount_percent INT := 30;
  v_discount_percent_applied INT := 0;
  v_discount_source TEXT := 'none';
  v_territory_deed_used BOOLEAN := FALSE;
  v_first_claim_discount_used BOOLEAN := FALSE;
  v_discount_multiplier NUMERIC := 1;

  v_effective_gold INT := 0;
  v_effective_wood INT := 0;
  v_effective_stone INT := 0;
  v_effective_food_claim INT := 0;
  v_total_food_cost INT := 0;

  v_reasons TEXT[] := ARRAY[]::TEXT[];
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_can_afford BOOLEAN := FALSE;
BEGIN
  SELECT id, gold, wood, stone, food
  INTO v_agent
  FROM agents
  WHERE id = p_agent_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'agent_not_found');
  END IF;

  SELECT x, y, terrain, owner_id
  INTO v_tile
  FROM tiles
  WHERE x = p_x AND y = p_y;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tile_not_found');
  END IF;

  SELECT COUNT(*) INTO v_territory_count
  FROM tiles
  WHERE owner_id = p_agent_id;

  SELECT id, quantity, uses_remaining
  INTO v_deed
  FROM agent_items
  WHERE agent_id = p_agent_id
    AND item_id = 'territory_deed'
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND
    AND COALESCE(v_deed.quantity, 0) > 0
    AND (v_deed.uses_remaining IS NULL OR v_deed.uses_remaining > 0)
  THEN
    v_deed_available := TRUE;
  END IF;

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

  IF v_tile.terrain = 'market' THEN
    v_reasons := array_append(v_reasons, 'market_tile');
  END IF;

  IF v_tile.terrain = 'water' THEN
    v_reasons := array_append(v_reasons, 'water_tile');
  END IF;

  IF v_tile.owner_id = p_agent_id THEN
    v_reasons := array_append(v_reasons, 'already_owned');
  ELSIF v_tile.owner_id IS NOT NULL AND v_tile.owner_id <> p_agent_id THEN
    v_reasons := array_append(v_reasons, 'tile_claimed');
  END IF;

  IF v_territory_count >= p_max_territories THEN
    v_reasons := array_append(v_reasons, 'territory_limit');
  END IF;

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
    v_missing := array_append(v_missing, format('food (need %s, have %s)', v_total_food_cost, v_agent.food));
  END IF;

  v_can_afford := COALESCE(array_length(v_missing, 1), 0) = 0;
  IF NOT v_can_afford THEN
    v_reasons := array_append(v_reasons, 'insufficient_resources');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'quote_version', 'v1',
    'can_execute', COALESCE(array_length(v_reasons, 1), 0) = 0,
    'can_afford', v_can_afford,
    'reasons', to_jsonb(v_reasons),
    'effective_cost', jsonb_build_object(
      'gold', v_effective_gold,
      'wood', v_effective_wood,
      'stone', v_effective_stone,
      'food_claim_cost', v_effective_food_claim,
      'stamina_cost', p_food_stamina_cost,
      'food_total', v_total_food_cost
    ),
    'discounts', jsonb_build_object(
      'territory_deed_available', v_deed_available,
      'territory_deed_discount_percent', GREATEST(0, p_deed_discount_percent),
      'territory_deed_used', v_territory_deed_used,
      'first_claim_discount_available', v_territory_count = 0,
      'first_claim_discount_used', v_first_claim_discount_used,
      'discount_percent_applied', v_discount_percent_applied,
      'discount_source', v_discount_source
    ),
    'missing_resources', to_jsonb(v_missing),
    'requirements', jsonb_build_object(
      'gold', jsonb_build_object(
        'need', v_effective_gold,
        'have', v_agent.gold,
        'missing', GREATEST(0, v_effective_gold - v_agent.gold)
      ),
      'wood', jsonb_build_object(
        'need', v_effective_wood,
        'have', v_agent.wood,
        'missing', GREATEST(0, v_effective_wood - v_agent.wood)
      ),
      'stone', jsonb_build_object(
        'need', v_effective_stone,
        'have', v_agent.stone,
        'missing', GREATEST(0, v_effective_stone - v_agent.stone)
      ),
      'food', jsonb_build_object(
        'need', v_total_food_cost,
        'have', v_agent.food,
        'missing', GREATEST(0, v_total_food_cost - v_agent.food)
      )
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION quote_claim_tile(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT) IS
'Non-mutating claim quote helper aligned to atomic claim pricing and discount rules.';

GRANT EXECUTE ON FUNCTION quote_claim_tile(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION quote_claim_tile(UUID, INT, INT, INT, INT, INT, INT, INT, INT, INT) TO authenticated;
