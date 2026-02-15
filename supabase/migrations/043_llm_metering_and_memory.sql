-- ============================================================================
-- 043: LLM call metering, memory telemetry, and atomic call consumption
-- ============================================================================

-- Credits now support fractional values (4 calls = 1 credit by default).
ALTER TABLE public.users
ALTER COLUMN credits_used TYPE numeric(12,3)
USING credits_used::numeric;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS llm_calls_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS autoplay_calls_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS last_memory_distilled_at timestamptz;

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS memory_version integer NOT NULL DEFAULT 0;

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS memory_digest text;

CREATE TABLE IF NOT EXISTS public.llm_call_consumptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text UNIQUE NOT NULL,
  config_id uuid NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('manual', 'autoplay', 'memory_distill')),
  calls integer NOT NULL DEFAULT 1 CHECK (calls > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_call_consumptions_user_created
  ON public.llm_call_consumptions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_call_consumptions_config_created
  ON public.llm_call_consumptions(config_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.consume_llm_call(
  p_config_id uuid,
  p_mode text,
  p_idempotency_key text
)
RETURNS TABLE (
  allowed boolean,
  consumed boolean,
  reason text,
  config_id uuid,
  user_id uuid,
  tier text,
  monthly_credit_limit integer,
  call_ceiling integer,
  reserve_calls integer,
  llm_calls_used integer,
  autoplay_calls_used integer,
  remaining_calls_total integer,
  remaining_calls_autoplay integer,
  credits_used numeric,
  credits_remaining numeric,
  credits_cycle_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
  v_mode text;
  v_existing record;
  v_call_ceiling integer;
  v_reserve_calls integer;
  v_remaining_before integer;
  v_llm_calls integer;
  v_autoplay_calls integer;
  v_credits_used numeric;
BEGIN
  IF p_config_id IS NULL THEN
    RETURN QUERY SELECT false, false, 'missing_config_id', NULL::uuid, NULL::uuid, NULL::text,
      0, 0, 0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz;
    RETURN;
  END IF;

  v_mode := lower(coalesce(p_mode, ''));
  IF v_mode NOT IN ('manual', 'autoplay', 'memory_distill') THEN
    RETURN QUERY SELECT false, false, 'invalid_mode', p_config_id, NULL::uuid, NULL::text,
      0, 0, 0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz;
    RETURN;
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN QUERY SELECT false, false, 'missing_idempotency_key', p_config_id, NULL::uuid, NULL::text,
      0, 0, 0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT
    cfg.id AS config_id,
    usr.id AS user_id,
    usr.tier,
    usr.monthly_credit_limit,
    usr.llm_calls_used,
    usr.autoplay_calls_used,
    usr.credits_used,
    usr.credits_cycle_end
  INTO v_user
  FROM public.agent_configs cfg
  JOIN public.users usr ON usr.id = cfg.user_id
  WHERE cfg.id = p_config_id
  FOR UPDATE OF usr;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, 'config_not_found', p_config_id, NULL::uuid, NULL::text,
      0, 0, 0, 0, 0, 0, 0, 0::numeric, 0::numeric, NULL::timestamptz;
    RETURN;
  END IF;

  v_call_ceiling := GREATEST(0, coalesce(v_user.monthly_credit_limit, 0) * 4);
  v_reserve_calls := CEIL(v_call_ceiling * 0.05)::integer;

  SELECT c.config_id, c.user_id
    INTO v_existing
  FROM public.llm_call_consumptions c
  WHERE c.idempotency_key = p_idempotency_key;

  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      true,
      false,
      'idempotent_replay',
      v_user.config_id,
      v_user.user_id,
      v_user.tier,
      v_user.monthly_credit_limit,
      v_call_ceiling,
      v_reserve_calls,
      coalesce(v_user.llm_calls_used, 0),
      coalesce(v_user.autoplay_calls_used, 0),
      GREATEST(0, v_call_ceiling - coalesce(v_user.llm_calls_used, 0)),
      GREATEST(0, (v_call_ceiling - v_reserve_calls) - coalesce(v_user.llm_calls_used, 0)),
      coalesce(v_user.credits_used, 0),
      GREATEST(0::numeric, coalesce(v_user.monthly_credit_limit, 0)::numeric - coalesce(v_user.credits_used, 0)),
      v_user.credits_cycle_end;
    RETURN;
  END IF;

  v_remaining_before := v_call_ceiling - coalesce(v_user.llm_calls_used, 0);
  IF v_remaining_before <= 0 THEN
    RETURN QUERY SELECT
      false,
      false,
      'cap_exhausted',
      v_user.config_id,
      v_user.user_id,
      v_user.tier,
      v_user.monthly_credit_limit,
      v_call_ceiling,
      v_reserve_calls,
      coalesce(v_user.llm_calls_used, 0),
      coalesce(v_user.autoplay_calls_used, 0),
      0,
      0,
      coalesce(v_user.credits_used, 0),
      GREATEST(0::numeric, coalesce(v_user.monthly_credit_limit, 0)::numeric - coalesce(v_user.credits_used, 0)),
      v_user.credits_cycle_end;
    RETURN;
  END IF;

  IF v_mode = 'autoplay' AND v_remaining_before <= v_reserve_calls THEN
    RETURN QUERY SELECT
      false,
      false,
      'manual_reserve',
      v_user.config_id,
      v_user.user_id,
      v_user.tier,
      v_user.monthly_credit_limit,
      v_call_ceiling,
      v_reserve_calls,
      coalesce(v_user.llm_calls_used, 0),
      coalesce(v_user.autoplay_calls_used, 0),
      v_remaining_before,
      GREATEST(0, v_remaining_before - v_reserve_calls),
      coalesce(v_user.credits_used, 0),
      GREATEST(0::numeric, coalesce(v_user.monthly_credit_limit, 0)::numeric - coalesce(v_user.credits_used, 0)),
      v_user.credits_cycle_end;
    RETURN;
  END IF;

  v_llm_calls := coalesce(v_user.llm_calls_used, 0) + 1;
  v_autoplay_calls := coalesce(v_user.autoplay_calls_used, 0) + CASE WHEN v_mode = 'autoplay' THEN 1 ELSE 0 END;
  v_credits_used := LEAST(coalesce(v_user.monthly_credit_limit, 0)::numeric, v_llm_calls::numeric / 4.0);

  UPDATE public.users
  SET
    llm_calls_used = v_llm_calls,
    autoplay_calls_used = v_autoplay_calls,
    credits_used = v_credits_used,
    updated_at = now()
  WHERE id = v_user.user_id;

  INSERT INTO public.llm_call_consumptions (idempotency_key, config_id, user_id, mode, calls)
  VALUES (p_idempotency_key, v_user.config_id, v_user.user_id, v_mode, 1)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY SELECT
    true,
    true,
    'consumed',
    v_user.config_id,
    v_user.user_id,
    v_user.tier,
    v_user.monthly_credit_limit,
    v_call_ceiling,
    v_reserve_calls,
    v_llm_calls,
    v_autoplay_calls,
    GREATEST(0, v_call_ceiling - v_llm_calls),
    GREATEST(0, (v_call_ceiling - v_reserve_calls) - v_llm_calls),
    v_credits_used,
    GREATEST(0::numeric, coalesce(v_user.monthly_credit_limit, 0)::numeric - v_credits_used),
    v_user.credits_cycle_end;
END;
$$;
