-- ============================================================================
-- 039: Add SOUL.md support to hosted agent configs
-- Backward-compatible additive migration for simplified builder rollout.
-- ============================================================================

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS soul_md text NOT NULL DEFAULT '';

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS builder_version integer NOT NULL DEFAULT 2;
