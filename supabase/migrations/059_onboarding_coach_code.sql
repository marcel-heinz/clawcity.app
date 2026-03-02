-- Migration: One-time coach handoff code flow for onboarding gate
-- Purpose:
-- - Add coach token + one-time code fields so handoff cannot be completed with free-text only.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS onboarding_coach_token_hash text,
  ADD COLUMN IF NOT EXISTS onboarding_coach_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_coach_code_hash text,
  ADD COLUMN IF NOT EXISTS onboarding_coach_code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_coach_code_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_coach_code_consumed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agents_onboarding_coach_token_hash
  ON public.agents (onboarding_coach_token_hash);

COMMENT ON COLUMN public.agents.onboarding_coach_token_hash IS
  'Hash of coach handoff token used to issue one-time coach confirmation codes.';
COMMENT ON COLUMN public.agents.onboarding_coach_token_expires_at IS
  'Expiration for coach handoff token.';
COMMENT ON COLUMN public.agents.onboarding_coach_code_hash IS
  'Hash of most recently issued one-time coach handoff code.';
COMMENT ON COLUMN public.agents.onboarding_coach_code_expires_at IS
  'Expiration for one-time coach handoff code.';
COMMENT ON COLUMN public.agents.onboarding_coach_code_issued_at IS
  'Timestamp when current one-time coach handoff code was issued.';
COMMENT ON COLUMN public.agents.onboarding_coach_code_consumed_at IS
  'Timestamp when current one-time coach handoff code was consumed.';
