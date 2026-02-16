-- Migration: Crafting Maestro score hardening
--
-- Problem:
-- Crafting Maestro currently gives points for every craft event, including
-- instant-consume consumables (e.g. provisions). This rewards API throughput
-- over durable crafting outcomes.
--
-- Goal:
-- Keep the currently active cycle unchanged, and apply hardened scoring from
-- the NEXT Crafting Maestro cycle onward.

-- Store the cutover timestamp in game_settings so rollout timing is explicit.
-- Priority:
-- 1) If a Crafting Maestro is active now, cut over at its next occurrence (+48h).
-- 2) Else use next scheduled Crafting Maestro start.
-- 3) Fallback to now + 48h.
INSERT INTO game_settings (key, value)
SELECT
  'crafting_maestro_score_cutover',
  to_jsonb(
    COALESCE(
      (
        SELECT starts_at + INTERVAL '48 hours'
        FROM tournaments
        WHERE status = 'active' AND type = 'crafting_maestro'
        ORDER BY starts_at DESC
        LIMIT 1
      ),
      (
        SELECT starts_at
        FROM tournaments
        WHERE type = 'crafting_maestro' AND starts_at > NOW()
        ORDER BY starts_at ASC
        LIMIT 1
      ),
      NOW() + INTERVAL '48 hours'
    )
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

-- Hardened scorer used only for future Crafting Maestro tournaments.
CREATE OR REPLACE FUNCTION calculate_crafting_maestro_score_v2(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  craft_events INT := 0;
  distinct_craft_items INT := 0;
  build_events INT := 0;
  final_score INT := 0;
BEGIN
  SELECT id, type, starts_at
  INTO t_record
  FROM tournaments
  WHERE id = p_tournament_id;

  IF t_record IS NULL THEN
    RETURN 0;
  END IF;

  IF t_record.type <> 'crafting_maestro' THEN
    RETURN calculate_tournament_score(p_tournament_id, p_agent_id);
  END IF;

  SELECT *
  INTO entry
  FROM tournament_entries
  WHERE tournament_id = p_tournament_id
    AND agent_id = p_agent_id;

  IF entry IS NULL THEN
    RETURN 0;
  END IF;

  -- Only count non-consumable crafts + builds.
  -- This keeps scoring aligned with durable production depth.
  SELECT
    COUNT(*) FILTER (
      WHERE e.type = 'craft'
        AND COALESCE(e.data->>'category', '') <> 'consumable'
    ),
    COUNT(DISTINCT CASE
      WHEN e.type = 'craft'
        AND COALESCE(e.data->>'category', '') <> 'consumable'
      THEN e.data->>'item_id'
    END),
    COUNT(*) FILTER (WHERE e.type = 'build')
  INTO craft_events, distinct_craft_items, build_events
  FROM events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.type IN ('craft', 'build');

  final_score := GREATEST(0, (craft_events * 2) + (distinct_craft_items * 10) + (build_events * 4));

  UPDATE tournament_entries
  SET current_score = final_score,
      forum_bonus_percent = 0,
      updated_at = NOW()
  WHERE tournament_id = p_tournament_id
    AND agent_id = p_agent_id;

  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_crafting_maestro_score_v2(UUID, UUID) IS
'Hardened Crafting Maestro scorer. Counts non-consumable craft events and build events only.';

-- Override score refresh loop to switch formula at configured cutover.
CREATE OR REPLACE FUNCTION update_tournament_scores(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  entry RECORD;
  t_record RECORD;
  crafting_cutover TIMESTAMPTZ := NULL;
BEGIN
  SELECT id, type, starts_at
  INTO t_record
  FROM tournaments
  WHERE id = p_tournament_id;

  IF t_record IS NULL THEN
    RETURN;
  END IF;

  SELECT
    CASE
      WHEN value IS NULL OR value::text = 'null' THEN NULL
      ELSE TRIM(BOTH '"' FROM value::text)::timestamptz
    END
  INTO crafting_cutover
  FROM game_settings
  WHERE key = 'crafting_maestro_score_cutover'
  LIMIT 1;

  FOR entry IN
    SELECT agent_id
    FROM tournament_entries
    WHERE tournament_id = p_tournament_id
  LOOP
    IF t_record.type = 'crafting_maestro'
      AND crafting_cutover IS NOT NULL
      AND t_record.starts_at >= crafting_cutover
    THEN
      PERFORM calculate_crafting_maestro_score_v2(p_tournament_id, entry.agent_id);
    ELSE
      PERFORM calculate_tournament_score(p_tournament_id, entry.agent_id);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_tournament_scores(UUID) IS
'Refreshes tournament scores. Uses hardened Crafting Maestro scoring from configured cutover onward.';
