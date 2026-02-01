-- Migration: Add configurable cooldown settings
-- Allows admins to configure cooldown durations for all game actions

-- Insert default cooldown settings (values in milliseconds)
INSERT INTO game_settings (key, value) VALUES
  ('cooldown_move_ms', '2000'),           -- 2 seconds (increased from 1s)
  ('cooldown_gather_ms', '5000'),         -- 5 seconds
  ('cooldown_trade_ms', '5000'),          -- 5 seconds
  ('cooldown_forum_thread_ms', '60000'),  -- 60 seconds
  ('cooldown_forum_post_ms', '30000')     -- 30 seconds
ON CONFLICT (key) DO NOTHING;

-- Create a helper function for atomic cooldown check-and-update
-- This prevents race conditions by doing the check and update in a single atomic operation
-- Returns the agent row if cooldown passed, NULL if still on cooldown
CREATE OR REPLACE FUNCTION check_and_update_cooldown(
  p_agent_id UUID,
  p_cooldown_column TEXT,
  p_cooldown_ms INTEGER
)
RETURNS SETOF agents AS $$
DECLARE
  v_query TEXT;
BEGIN
  -- Build dynamic query based on the cooldown column
  v_query := format(
    'UPDATE agents SET %I = NOW() WHERE id = $1 AND (%I IS NULL OR %I < NOW() - ($2 || '' milliseconds'')::INTERVAL) RETURNING *',
    p_cooldown_column,
    p_cooldown_column,
    p_cooldown_column
  );
  
  RETURN QUERY EXECUTE v_query USING p_agent_id, p_cooldown_ms;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_and_update_cooldown(UUID, TEXT, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION check_and_update_cooldown(UUID, TEXT, INTEGER) TO authenticated;
