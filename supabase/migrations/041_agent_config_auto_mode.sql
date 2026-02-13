-- ============================================================================
-- 041: Per-agent auto-mode toggle for hosted agents
-- ============================================================================

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS auto_mode_enabled boolean NOT NULL DEFAULT true;
