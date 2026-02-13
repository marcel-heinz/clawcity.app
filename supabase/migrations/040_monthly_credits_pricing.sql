-- ============================================================================
-- 040: Monthly credits for hosted agent pricing (starter/pro)
-- Backward-compatible with existing daily decision counters.
-- ============================================================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS monthly_credit_limit integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS credits_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS credits_cycle_start timestamptz;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS credits_cycle_end timestamptz;

-- Backfill existing rows from current tier.
UPDATE public.users
SET monthly_credit_limit = CASE
  WHEN tier = 'starter' THEN 2500
  WHEN tier = 'pro' THEN 6000
  ELSE 0
END
WHERE monthly_credit_limit = 0;

-- Keep legacy daily counters for compatibility, but sync new monthly limits.
CREATE OR REPLACE FUNCTION public.update_tier_limits()
RETURNS trigger AS $$
BEGIN
  IF NEW.tier = 'free' THEN
    NEW.max_agents := 0;
    NEW.max_decisions_per_day := 0;
    NEW.monthly_credit_limit := 0;
  ELSIF NEW.tier = 'starter' THEN
    NEW.max_agents := 1;
    NEW.max_decisions_per_day := 200;
    NEW.monthly_credit_limit := 2500;
  ELSIF NEW.tier = 'pro' THEN
    NEW.max_agents := 1;
    NEW.max_decisions_per_day := 800;
    NEW.monthly_credit_limit := 6000;
  END IF;

  -- Clamp usage if tier was downgraded.
  IF NEW.credits_used > NEW.monthly_credit_limit THEN
    NEW.credits_used := NEW.monthly_credit_limit;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
