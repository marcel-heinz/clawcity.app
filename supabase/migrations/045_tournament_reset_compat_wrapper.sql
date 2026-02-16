-- Migration: Tournament reset compatibility wrapper
--
-- Purpose:
-- Ensure all legacy no-arg callers use the full reset implementation introduced
-- in reset_all_agents_for_tournament(UUID).

CREATE OR REPLACE FUNCTION reset_all_agents_for_tournament()
RETURNS INT AS $$
BEGIN
  RETURN reset_all_agents_for_tournament(NULL::UUID);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION reset_all_agents_for_tournament() IS
'Compatibility wrapper: delegates no-arg reset calls to reset_all_agents_for_tournament(UUID),
which performs the full tournament reset (resources, items, buildings, territories, depletion).';
