-- Migration: Server-side onboarding mutation gate
-- Purpose:
-- 1) Require coach handoff confirmation before mutating gameplay actions
-- 2) Require Oracle briefing completion before mutating gameplay actions
-- 3) Keep existing agents unaffected by default (gate_required = false)

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS onboarding_gate_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_coach_handoff_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_coach_storage_method text,
  ADD COLUMN IF NOT EXISTS onboarding_coach_kickoff_strategy text,
  ADD COLUMN IF NOT EXISTS onboarding_coach_handoff_source text,
  ADD COLUMN IF NOT EXISTS onboarding_oracle_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agents_onboarding_gate_required
  ON public.agents (onboarding_gate_required);

COMMENT ON COLUMN public.agents.onboarding_gate_required IS
  'When true, mutating gameplay actions are blocked until coach handoff + oracle completion are confirmed.';
COMMENT ON COLUMN public.agents.onboarding_coach_handoff_confirmed_at IS
  'Timestamp when coach handoff gate was confirmed.';
COMMENT ON COLUMN public.agents.onboarding_coach_storage_method IS
  'Coach-confirmed API key storage location/method captured during onboarding.';
COMMENT ON COLUMN public.agents.onboarding_coach_kickoff_strategy IS
  'Coach-provided kickoff strategy summary captured during onboarding.';
COMMENT ON COLUMN public.agents.onboarding_coach_handoff_source IS
  'How the handoff confirmation was completed (e.g. cli_handoff).';
COMMENT ON COLUMN public.agents.onboarding_oracle_completed_at IS
  'Timestamp of first successful Oracle briefing call.';
