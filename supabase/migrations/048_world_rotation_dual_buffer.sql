-- Migration: Dual-buffer world rotation with automatic 2-tournament cadence
--
-- Goals:
-- 1) Keep active gameplay stable on `tiles` while preloading next world in `tiles_next`
-- 2) Rotate world design every second tournament using tournament week_number
-- 3) Make tournament-start reset + world swap atomic and cron-safe
-- 4) Provide runtime validators and chunked generation state tracking

-- ============================================================================
-- 1) STAGING TABLE: tiles_next
-- ============================================================================

CREATE TABLE IF NOT EXISTS tiles_next (
  LIKE tiles INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING IDENTITY INCLUDING GENERATED
);

CREATE INDEX IF NOT EXISTS idx_tiles_next_terrain ON tiles_next(terrain);
CREATE INDEX IF NOT EXISTS idx_tiles_next_owner ON tiles_next(owner_id);
CREATE INDEX IF NOT EXISTS idx_tiles_next_depleted ON tiles_next(depleted, depleted_at);
CREATE INDEX IF NOT EXISTS idx_tiles_next_regenerates_at ON tiles_next(regenerates_at)
WHERE regenerates_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiles_next_building_type ON tiles_next(building_type)
WHERE building_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiles_next_owner_building ON tiles_next(owner_id, building_type)
WHERE owner_id IS NOT NULL AND building_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiles_next_upgrade_level ON tiles_next(upgrade_level)
WHERE upgrade_level > 1;

ALTER TABLE tiles_next ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to tiles_next" ON tiles_next;
CREATE POLICY "Service role full access to tiles_next"
  ON tiles_next
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- 2) WORLD RUNTIME STATE (singleton row)
-- ============================================================================

CREATE TABLE IF NOT EXISTS world_runtime_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  active_design_no INT NOT NULL DEFAULT 1 CHECK (active_design_no >= 1),
  active_seed INT NOT NULL DEFAULT 42,
  active_config JSONB NOT NULL DEFAULT jsonb_build_object(
    'seed', 42,
    'elevationScale', 250,
    'moistureScale', 200,
    'detailScale', 500
  ),
  next_design_no INT CHECK (next_design_no IS NULL OR next_design_no >= 1),
  next_seed INT,
  next_config JSONB,
  next_status TEXT NOT NULL DEFAULT 'empty' CHECK (next_status IN ('empty', 'generating', 'ready', 'failed')),
  next_cursor_y INT NOT NULL DEFAULT 0 CHECK (next_cursor_y >= 0 AND next_cursor_y <= 500),
  next_generated_rows INT NOT NULL DEFAULT 0 CHECK (next_generated_rows >= 0),
  next_last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE world_runtime_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access to world_runtime_state" ON world_runtime_state;
CREATE POLICY "Service role full access to world_runtime_state"
  ON world_runtime_state
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION update_world_runtime_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_world_runtime_state_updated_at ON world_runtime_state;
CREATE TRIGGER trigger_world_runtime_state_updated_at
  BEFORE UPDATE ON world_runtime_state
  FOR EACH ROW
  EXECUTE FUNCTION update_world_runtime_state_timestamp();

INSERT INTO world_runtime_state (singleton, active_design_no, active_seed, active_config, next_status)
VALUES (
  TRUE,
  COALESCE((SELECT ((MAX(week_number) - 1) / 2) + 1 FROM tournaments), 1),
  42,
  jsonb_build_object(
    'seed', 42,
    'elevationScale', 250,
    'moistureScale', 200,
    'detailScale', 500
  ),
  'empty'
)
ON CONFLICT (singleton) DO NOTHING;

-- ============================================================================
-- 3) WORLD HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION world_default_config(p_seed INT)
RETURNS JSONB AS $$
BEGIN
  RETURN jsonb_build_object(
    'seed', p_seed,
    'elevationScale', 250,
    'moistureScale', 200,
    'detailScale', 500
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION world_seed_for_design(p_design_no INT)
RETURNS INT AS $$
BEGIN
  IF p_design_no < 1 THEN
    RAISE EXCEPTION 'design_no must be >= 1';
  END IF;

  -- Design #1 intentionally maps to existing live seed 42 for compatibility.
  RETURN 42 + ((p_design_no - 1) * 7919);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION world_design_no_for_week(p_week_number INT)
RETURNS INT AS $$
BEGIN
  IF p_week_number < 1 THEN
    RAISE EXCEPTION 'week_number must be >= 1';
  END IF;

  RETURN ((p_week_number - 1) / 2) + 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- 4) WORLD TABLE VALIDATOR
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_world_table(
  p_table_name TEXT,
  p_expect_clean BOOLEAN DEFAULT FALSE
) RETURNS JSONB AS $$
DECLARE
  v_table TEXT;
  v_row_count INT := 0;
  v_out_of_bounds INT := 0;
  v_invalid_terrain INT := 0;
  v_market_count INT := 0;
  v_dirty_rows INT := 0;
  v_ok BOOLEAN := TRUE;
  v_reason TEXT := 'ok';
BEGIN
  IF p_table_name NOT IN ('tiles', 'tiles_next') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'invalid_table_name',
      'table', p_table_name
    );
  END IF;

  v_table := p_table_name;

  EXECUTE format('SELECT COUNT(*)::INT FROM %I', v_table)
  INTO v_row_count;

  EXECUTE format(
    'SELECT COUNT(*)::INT
     FROM %I
     WHERE x < 0 OR x > 499 OR y < 0 OR y > 499',
    v_table
  )
  INTO v_out_of_bounds;

  EXECUTE format(
    $sql$SELECT COUNT(*)::INT
      FROM %I
      WHERE terrain NOT IN (
        'plains', 'forest', 'mountain', 'market', 'water',
        'rocky', 'sand', 'deep_water', 'marsh'
      )$sql$,
    v_table
  )
  INTO v_invalid_terrain;

  EXECUTE format(
    'WITH expected AS (
       SELECT 50 + (mx * 100) AS x, 50 + (my * 100) AS y
       FROM generate_series(0, 4) AS mx
       CROSS JOIN generate_series(0, 4) AS my
     )
     SELECT COUNT(*)::INT
     FROM expected e
     JOIN %I t
       ON t.x = e.x
      AND t.y = e.y
      AND t.terrain = ''market''',
    v_table
  )
  INTO v_market_count;

  IF p_expect_clean THEN
    EXECUTE format(
      'SELECT COUNT(*)::INT
       FROM %I
       WHERE owner_id IS NOT NULL
          OR claimed_at IS NOT NULL
          OR building_type IS NOT NULL
          OR COALESCE(upgrade_level, 1) <> 1
          OR COALESCE(gather_count, 0) <> 0
          OR regenerates_at IS NOT NULL
          OR COALESCE(depleted, FALSE) = TRUE
          OR depleted_at IS NOT NULL',
      v_table
    )
    INTO v_dirty_rows;
  END IF;

  IF v_row_count <> 250000 THEN
    v_ok := FALSE;
    v_reason := 'row_count_mismatch';
  ELSIF v_out_of_bounds <> 0 THEN
    v_ok := FALSE;
    v_reason := 'out_of_bounds_coordinates';
  ELSIF v_invalid_terrain <> 0 THEN
    v_ok := FALSE;
    v_reason := 'invalid_terrain_values';
  ELSIF v_market_count <> 25 THEN
    v_ok := FALSE;
    v_reason := 'market_layout_mismatch';
  ELSIF p_expect_clean AND v_dirty_rows <> 0 THEN
    v_ok := FALSE;
    v_reason := 'non_clean_world_rows';
  END IF;

  RETURN jsonb_build_object(
    'ok', v_ok,
    'reason', v_reason,
    'table', v_table,
    'row_count', v_row_count,
    'out_of_bounds', v_out_of_bounds,
    'invalid_terrain', v_invalid_terrain,
    'market_count', v_market_count,
    'dirty_rows', v_dirty_rows
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5) NEXT-WORLD PREPARATION / PROGRESS
-- ============================================================================

CREATE OR REPLACE FUNCTION world_prepare_next_generation(p_force BOOLEAN DEFAULT FALSE)
RETURNS JSONB AS $$
DECLARE
  v_state world_runtime_state%ROWTYPE;
  v_expected_next_design INT;
  v_seed INT;
  v_cfg JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('world_prepare_next_generation'));

  INSERT INTO world_runtime_state (singleton) VALUES (TRUE)
  ON CONFLICT (singleton) DO NOTHING;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE
  FOR UPDATE;

  v_expected_next_design := v_state.active_design_no + 1;

  IF p_force OR v_state.next_status = 'failed' OR v_state.next_status = 'empty' OR v_state.next_design_no IS DISTINCT FROM v_expected_next_design THEN
    v_seed := world_seed_for_design(v_expected_next_design);
    v_cfg := world_default_config(v_seed);

    TRUNCATE TABLE tiles_next;

    UPDATE world_runtime_state
    SET
      next_design_no = v_expected_next_design,
      next_seed = v_seed,
      next_config = v_cfg,
      next_status = 'generating',
      next_cursor_y = 0,
      next_generated_rows = 0,
      next_last_error = NULL
    WHERE singleton = TRUE;
  END IF;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE;

  RETURN jsonb_build_object(
    'active_design_no', v_state.active_design_no,
    'active_seed', v_state.active_seed,
    'next_design_no', v_state.next_design_no,
    'next_seed', v_state.next_seed,
    'next_config', v_state.next_config,
    'next_status', v_state.next_status,
    'next_cursor_y', v_state.next_cursor_y,
    'next_generated_rows', v_state.next_generated_rows
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION world_mark_next_generation_progress(
  p_design_no INT,
  p_new_cursor_y INT,
  p_last_error TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_state world_runtime_state%ROWTYPE;
  v_validation JSONB;
  v_row_count INT := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('world_mark_next_generation_progress'));

  INSERT INTO world_runtime_state (singleton) VALUES (TRUE)
  ON CONFLICT (singleton) DO NOTHING;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE
  FOR UPDATE;

  IF v_state.next_status <> 'generating' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'next_world_not_generating',
      'next_status', v_state.next_status,
      'next_design_no', v_state.next_design_no
    );
  END IF;

  IF v_state.next_design_no IS DISTINCT FROM p_design_no THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'design_mismatch',
      'expected_design_no', v_state.next_design_no,
      'provided_design_no', p_design_no
    );
  END IF;

  IF p_last_error IS NOT NULL THEN
    UPDATE world_runtime_state
    SET
      next_status = 'failed',
      next_last_error = p_last_error
    WHERE singleton = TRUE;

    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'generation_failed',
      'error', p_last_error
    );
  END IF;

  SELECT COUNT(*)::INT INTO v_row_count FROM tiles_next;

  UPDATE world_runtime_state
  SET
    next_cursor_y = GREATEST(next_cursor_y, LEAST(500, GREATEST(0, p_new_cursor_y))),
    next_generated_rows = v_row_count
  WHERE singleton = TRUE;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE
  FOR UPDATE;

  IF v_state.next_cursor_y >= 500 THEN
    v_validation := validate_world_table('tiles_next', TRUE);

    IF COALESCE((v_validation->>'ok')::BOOLEAN, FALSE) THEN
      UPDATE world_runtime_state
      SET
        next_status = 'ready',
        next_generated_rows = 250000,
        next_last_error = NULL
      WHERE singleton = TRUE;
    ELSE
      UPDATE world_runtime_state
      SET
        next_status = 'failed',
        next_last_error = COALESCE(v_validation->>'reason', 'validation_failed')
      WHERE singleton = TRUE;
    END IF;
  END IF;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'next_design_no', v_state.next_design_no,
    'next_status', v_state.next_status,
    'next_cursor_y', v_state.next_cursor_y,
    'next_generated_rows', v_state.next_generated_rows,
    'next_last_error', v_state.next_last_error
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6) TOURNAMENT START PREP (reset + optional atomic world swap)
-- ============================================================================

CREATE OR REPLACE FUNCTION prepare_world_for_tournament_start(p_tournament_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_state world_runtime_state%ROWTYPE;
  v_tournament RECORD;
  v_target_design INT;
  v_rotate_needed BOOLEAN := FALSE;
  v_rotated BOOLEAN := FALSE;
  v_reset_count INT := 0;
  v_validation JSONB;
  v_status TEXT := 'noop';
  v_message TEXT := 'No world rotation needed for this tournament window.';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('prepare_world_for_tournament_start'));

  INSERT INTO world_runtime_state (singleton) VALUES (TRUE)
  ON CONFLICT (singleton) DO NOTHING;

  SELECT * INTO v_tournament
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 'error',
      'reason', 'tournament_not_found',
      'tournament_id', p_tournament_id
    );
  END IF;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE
  FOR UPDATE;

  v_target_design := world_design_no_for_week(v_tournament.week_number);
  v_rotate_needed := v_target_design > v_state.active_design_no;

  -- Always run full reset at tournament start.
  v_reset_count := reset_all_agents_for_tournament(p_tournament_id);

  IF v_rotate_needed THEN
    IF v_state.next_status = 'ready'
       AND v_state.next_design_no IS NOT NULL
       AND v_state.next_design_no > v_state.active_design_no
       AND v_state.next_design_no <= v_target_design
    THEN
      v_validation := validate_world_table('tiles_next', TRUE);

      IF COALESCE((v_validation->>'ok')::BOOLEAN, FALSE) THEN
        TRUNCATE TABLE tiles;
        INSERT INTO tiles SELECT * FROM tiles_next;
        TRUNCATE TABLE tiles_next;

        UPDATE world_runtime_state
        SET
          active_design_no = v_state.next_design_no,
          active_seed = COALESCE(v_state.next_seed, world_seed_for_design(v_state.next_design_no)),
          active_config = COALESCE(v_state.next_config, world_default_config(world_seed_for_design(v_state.next_design_no))),
          next_design_no = NULL,
          next_seed = NULL,
          next_config = NULL,
          next_status = 'empty',
          next_cursor_y = 0,
          next_generated_rows = 0,
          next_last_error = NULL
        WHERE singleton = TRUE;

        v_rotated := TRUE;
        IF v_state.next_design_no = v_target_design THEN
          v_status := 'rotated';
          v_message := format('Rotated world to design #%s for tournament week %s.', v_state.next_design_no, v_tournament.week_number);
        ELSE
          v_status := 'rotated_catchup';
          v_message := format(
            'Rotated world to catch-up design #%s (target #%s) for tournament week %s.',
            v_state.next_design_no,
            v_target_design,
            v_tournament.week_number
          );
        END IF;
      ELSE
        UPDATE world_runtime_state
        SET
          next_status = 'failed',
          next_last_error = COALESCE(v_validation->>'reason', 'validation_failed_before_swap')
        WHERE singleton = TRUE;

        v_status := 'fallback_not_swapped_invalid_next';
        v_message := 'Next world validation failed. Continued with active world.';
      END IF;
    ELSE
      v_status := 'fallback_not_swapped_not_ready';
      v_message := 'Next world is not ready for required design. Continued with active world.';
    END IF;
  END IF;

  SELECT * INTO v_state
  FROM world_runtime_state
  WHERE singleton = TRUE;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'status', v_status,
    'message', v_message,
    'tournament_id', p_tournament_id,
    'tournament_name', v_tournament.name,
    'tournament_week', v_tournament.week_number,
    'target_design_no', v_target_design,
    'active_design_no', v_state.active_design_no,
    'rotated', v_rotated,
    'reset_agent_count', v_reset_count,
    'next_status', v_state.next_status,
    'next_design_no', v_state.next_design_no
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION world_design_no_for_week(INT) IS
'Returns world design number for a tournament week. 1-2 => #1, 3-4 => #2, 5-6 => #3, ...';

COMMENT ON FUNCTION validate_world_table(TEXT, BOOLEAN) IS
'Validates tiles/tiles_next integrity, including row counts, bounds, terrain values, market layout, and optional cleanliness checks.';

COMMENT ON FUNCTION world_prepare_next_generation(BOOLEAN) IS
'Initializes or resumes next-world generation state for tiles_next.';

COMMENT ON FUNCTION world_mark_next_generation_progress(INT, INT, TEXT) IS
'Records next-world generation progress and marks tiles_next ready once full validation passes.';

COMMENT ON FUNCTION prepare_world_for_tournament_start(UUID) IS
'Runs full tournament reset and atomically swaps tiles_next into tiles when the 2-tournament design boundary is reached and next world is ready.';

GRANT EXECUTE ON FUNCTION world_prepare_next_generation(BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION world_prepare_next_generation(BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION world_mark_next_generation_progress(INT, INT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION world_mark_next_generation_progress(INT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION prepare_world_for_tournament_start(UUID) TO anon;
GRANT EXECUTE ON FUNCTION prepare_world_for_tournament_start(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION validate_world_table(TEXT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION validate_world_table(TEXT, BOOLEAN) TO authenticated;
