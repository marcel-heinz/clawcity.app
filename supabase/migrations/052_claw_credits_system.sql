-- Migration 052: Claw Credits economy, participation rewards, and tournament cutoff hardening
--
-- Product decisions implemented:
-- - Currency: Claw Credits
-- - Podium rewards: Gold 5000, Silver 3000, Bronze 1000
-- - Participation rewards: 100 Claw Credits for ranks 4+ with low-bar movement participation
-- - Unlock timing: rewards unlock from the next tournament week onward
-- - No reward expiry
-- - Retroactive backfill for historical ended tournaments
-- - Perks:
--   - instant_storage (1000 credits, one per tournament, +500 cap)
--   - durable_axe (500 credits per purchase, stackable uses, default +30 uses each)
-- - Tournament score cutoff at ends_at

-- ============================================================================
-- 1) CORE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.claw_credit_wallets (
  agent_id UUID PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_earned BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_earned >= 0),
  lifetime_spent BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.claw_credit_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  source_tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  source_week_number INT NOT NULL,
  reward_kind TEXT NOT NULL CHECK (reward_kind IN ('podium_gold', 'podium_silver', 'podium_bronze', 'participation')),
  rank INT,
  amount INT NOT NULL CHECK (amount > 0),
  unlock_week_number INT NOT NULL CHECK (unlock_week_number > 0),
  source_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  claim_ledger_entry_id UUID
);

CREATE INDEX IF NOT EXISTS idx_claw_credit_rewards_agent_claimed ON public.claw_credit_rewards(agent_id, claimed_at);
CREATE INDEX IF NOT EXISTS idx_claw_credit_rewards_tournament ON public.claw_credit_rewards(source_tournament_id);
CREATE INDEX IF NOT EXISTS idx_claw_credit_rewards_unlock ON public.claw_credit_rewards(unlock_week_number);

CREATE TABLE IF NOT EXISTS public.claw_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  delta INT NOT NULL,
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('claim', 'perk_purchase', 'refund', 'admin_adjustment', 'backfill')),
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claw_credit_ledger_agent_created ON public.claw_credit_ledger(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claw_credit_ledger_entry_type ON public.claw_credit_ledger(entry_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_claw_credit_ledger_agent_idempotency
  ON public.claw_credit_ledger(agent_id, idempotency_key);

CREATE TABLE IF NOT EXISTS public.tournament_participation (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  final_rank INT NOT NULL,
  moved_tiles INT NOT NULL DEFAULT 0 CHECK (moved_tiles >= 0),
  qualified BOOLEAN NOT NULL DEFAULT FALSE,
  reward_amount INT NOT NULL DEFAULT 0 CHECK (reward_amount >= 0),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_participation_rank ON public.tournament_participation(tournament_id, final_rank ASC);
CREATE INDEX IF NOT EXISTS idx_tournament_participation_qualified ON public.tournament_participation(tournament_id, qualified);
CREATE INDEX IF NOT EXISTS idx_tournament_participation_agent ON public.tournament_participation(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_perk_loadouts (
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  storage_bonus_count INT NOT NULL DEFAULT 0 CHECK (storage_bonus_count >= 0),
  durable_axe_uses_remaining INT NOT NULL DEFAULT 0 CHECK (durable_axe_uses_remaining >= 0),
  durable_axe_purchases INT NOT NULL DEFAULT 0 CHECK (durable_axe_purchases >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_perk_loadouts_agent ON public.tournament_perk_loadouts(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_perk_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  perk_id TEXT NOT NULL CHECK (perk_id IN ('instant_storage', 'durable_axe')),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  claw_credit_cost INT NOT NULL CHECK (claw_credit_cost >= 0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_perk_purchases_agent_tournament
  ON public.tournament_perk_purchases(agent_id, tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tournament_perk_purchases_perk
  ON public.tournament_perk_purchases(tournament_id, perk_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tournament_perk_purchases_agent_idempotency
  ON public.tournament_perk_purchases(agent_id, idempotency_key);

-- ============================================================================
-- 2) TIMESTAMP TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_claw_credit_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_claw_credit_wallets_updated_at ON public.claw_credit_wallets;
CREATE TRIGGER trigger_claw_credit_wallets_updated_at
  BEFORE UPDATE ON public.claw_credit_wallets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_claw_credit_timestamp();

DROP TRIGGER IF EXISTS trigger_tournament_participation_updated_at ON public.tournament_participation;
CREATE TRIGGER trigger_tournament_participation_updated_at
  BEFORE UPDATE ON public.tournament_participation
  FOR EACH ROW
  EXECUTE FUNCTION public.update_claw_credit_timestamp();

DROP TRIGGER IF EXISTS trigger_tournament_perk_loadouts_updated_at ON public.tournament_perk_loadouts;
CREATE TRIGGER trigger_tournament_perk_loadouts_updated_at
  BEFORE UPDATE ON public.tournament_perk_loadouts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_claw_credit_timestamp();

-- ============================================================================
-- 3) SETTINGS DEFAULTS
-- ============================================================================

INSERT INTO public.game_settings (key, value)
VALUES
  ('claw_credit_podium_gold', to_jsonb(5000)),
  ('claw_credit_podium_silver', to_jsonb(3000)),
  ('claw_credit_podium_bronze', to_jsonb(1000)),
  ('claw_credit_participation_reward', to_jsonb(100)),
  ('claw_credit_participation_min_moved_tiles', to_jsonb(3)),
  ('claw_credit_perk_instant_storage_cost', to_jsonb(1000)),
  ('claw_credit_perk_storage_bonus', to_jsonb(500)),
  ('claw_credit_perk_durable_axe_cost', to_jsonb(500)),
  ('claw_credit_perk_durable_axe_uses', to_jsonb(30)),
  ('claw_credit_perk_durable_axe_purchase_cap', to_jsonb(10))
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4) RLS POLICIES
-- ============================================================================

ALTER TABLE public.claw_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claw_credit_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claw_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_perk_loadouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_perk_purchases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'claw_credit_wallets' AND policyname = 'Service role full access claw_credit_wallets'
  ) THEN
    CREATE POLICY "Service role full access claw_credit_wallets"
      ON public.claw_credit_wallets
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'claw_credit_rewards' AND policyname = 'Service role full access claw_credit_rewards'
  ) THEN
    CREATE POLICY "Service role full access claw_credit_rewards"
      ON public.claw_credit_rewards
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'claw_credit_ledger' AND policyname = 'Service role full access claw_credit_ledger'
  ) THEN
    CREATE POLICY "Service role full access claw_credit_ledger"
      ON public.claw_credit_ledger
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_participation' AND policyname = 'Public read tournament participation'
  ) THEN
    CREATE POLICY "Public read tournament participation"
      ON public.tournament_participation
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_participation' AND policyname = 'Service role full access tournament participation'
  ) THEN
    CREATE POLICY "Service role full access tournament participation"
      ON public.tournament_participation
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_perk_loadouts' AND policyname = 'Service role full access tournament_perk_loadouts'
  ) THEN
    CREATE POLICY "Service role full access tournament_perk_loadouts"
      ON public.tournament_perk_loadouts
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'tournament_perk_purchases' AND policyname = 'Service role full access tournament_perk_purchases'
  ) THEN
    CREATE POLICY "Service role full access tournament_perk_purchases"
      ON public.tournament_perk_purchases
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ============================================================================
-- 5) HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claw_credit_setting_int(p_key TEXT, p_default INT)
RETURNS INT AS $$
DECLARE
  v_value JSONB;
  v_text TEXT;
BEGIN
  SELECT value INTO v_value
  FROM public.game_settings
  WHERE key = p_key
  LIMIT 1;

  IF v_value IS NULL THEN
    RETURN p_default;
  END IF;

  IF jsonb_typeof(v_value) = 'number' THEN
    RETURN FLOOR((v_value::text)::numeric)::INT;
  END IF;

  IF jsonb_typeof(v_value) = 'string' THEN
    v_text := TRIM(BOTH '"' FROM v_value::text);
    RETURN v_text::INT;
  END IF;

  RETURN p_default;
EXCEPTION
  WHEN OTHERS THEN
    RETURN p_default;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.ensure_claw_credit_wallet(p_agent_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.claw_credit_wallets (agent_id)
  VALUES (p_agent_id)
  ON CONFLICT (agent_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.current_started_tournament_week()
RETURNS INT AS $$
DECLARE
  v_week INT;
BEGIN
  SELECT COALESCE(MAX(week_number), 0)
  INTO v_week
  FROM public.tournaments
  WHERE status IN ('active', 'ended');

  RETURN COALESCE(v_week, 0);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.get_active_tournament_storage_bonus(p_agent_id UUID)
RETURNS INT AS $$
DECLARE
  v_tournament_id UUID;
  v_bonus_count INT := 0;
  v_bonus_per_stack INT := 500;
BEGIN
  SELECT id INTO v_tournament_id
  FROM public.tournaments
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT storage_bonus_count
  INTO v_bonus_count
  FROM public.tournament_perk_loadouts
  WHERE tournament_id = v_tournament_id
    AND agent_id = p_agent_id;

  v_bonus_per_stack := public.claw_credit_setting_int('claw_credit_perk_storage_bonus', 500);
  RETURN COALESCE(v_bonus_count, 0) * GREATEST(0, v_bonus_per_stack);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.get_active_tournament_durable_axe_uses(p_agent_id UUID)
RETURNS INT AS $$
DECLARE
  v_tournament_id UUID;
  v_uses INT := 0;
BEGIN
  SELECT id INTO v_tournament_id
  FROM public.tournaments
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_tournament_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT durable_axe_uses_remaining
  INTO v_uses
  FROM public.tournament_perk_loadouts
  WHERE tournament_id = v_tournament_id
    AND agent_id = p_agent_id;

  RETURN COALESCE(v_uses, 0);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.consume_durable_axe_use(p_agent_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tournament RECORD;
  v_loadout RECORD;
BEGIN
  SELECT id, week_number
  INTO v_tournament
  FROM public.tournaments
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'no_active_tournament',
      'uses_remaining', 0
    );
  END IF;

  SELECT *
  INTO v_loadout
  FROM public.tournament_perk_loadouts
  WHERE tournament_id = v_tournament.id
    AND agent_id = p_agent_id
  FOR UPDATE;

  IF v_loadout IS NULL OR COALESCE(v_loadout.durable_axe_uses_remaining, 0) <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'no_uses_remaining',
      'tournament_id', v_tournament.id,
      'uses_remaining', 0
    );
  END IF;

  UPDATE public.tournament_perk_loadouts
  SET durable_axe_uses_remaining = durable_axe_uses_remaining - 1
  WHERE tournament_id = v_tournament.id
    AND agent_id = p_agent_id;

  RETURN jsonb_build_object(
    'ok', true,
    'applied', true,
    'tournament_id', v_tournament.id,
    'uses_remaining', GREATEST(0, v_loadout.durable_axe_uses_remaining - 1)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6) PARTICIPATION CALCULATION (LOW-BARRIER RULE)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_tournament_participation(p_tournament_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tournament RECORD;
  v_min_moved_tiles INT := 3;
  v_reward_amount INT := 100;
  v_total_rows INT := 0;
  v_qualified_rows INT := 0;
BEGIN
  SELECT id, starts_at, ends_at
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found', 'tournament_id', p_tournament_id);
  END IF;

  v_min_moved_tiles := public.claw_credit_setting_int('claw_credit_participation_min_moved_tiles', 3);
  v_reward_amount := public.claw_credit_setting_int('claw_credit_participation_reward', 100);

  WITH ranked_entries AS (
    SELECT
      te.tournament_id,
      te.agent_id,
      COALESCE(
        te.final_rank,
        ROW_NUMBER() OVER (
          PARTITION BY te.tournament_id
          ORDER BY te.current_score DESC, te.joined_at ASC
        )
      ) AS resolved_rank
    FROM public.tournament_entries te
    JOIN public.agents a ON a.id = te.agent_id
    WHERE te.tournament_id = p_tournament_id
      AND COALESCE(a.is_system, FALSE) = FALSE
  ),
  move_tiles AS (
    SELECT
      e.agent_id,
      COALESCE(SUM(
        CASE
          WHEN jsonb_typeof(e.data->'steps') = 'number' THEN GREATEST((e.data->>'steps')::INT, 1)
          WHEN (
            jsonb_typeof(e.data->'from') = 'object'
            AND jsonb_typeof(e.data->'to') = 'object'
            AND (e.data->'from'->>'x') ~ '^-?[0-9]+$'
            AND (e.data->'from'->>'y') ~ '^-?[0-9]+$'
            AND (e.data->'to'->>'x') ~ '^-?[0-9]+$'
            AND (e.data->'to'->>'y') ~ '^-?[0-9]+$'
          ) THEN GREATEST(
            ABS((e.data->'to'->>'x')::INT - (e.data->'from'->>'x')::INT)
            + ABS((e.data->'to'->>'y')::INT - (e.data->'from'->>'y')::INT),
            1
          )
          ELSE 1
        END
      ), 0)::INT AS moved_tiles
    FROM public.events e
    WHERE e.type = 'move'
      AND e.created_at >= v_tournament.starts_at
      AND e.created_at <= v_tournament.ends_at
    GROUP BY e.agent_id
  ),
  prepared AS (
    SELECT
      re.tournament_id,
      re.agent_id,
      re.resolved_rank AS final_rank,
      COALESCE(mt.moved_tiles, 0) AS moved_tiles,
      (re.resolved_rank >= 4 AND COALESCE(mt.moved_tiles, 0) >= v_min_moved_tiles) AS qualified
    FROM ranked_entries re
    LEFT JOIN move_tiles mt ON mt.agent_id = re.agent_id
  )
  INSERT INTO public.tournament_participation (
    tournament_id,
    agent_id,
    final_rank,
    moved_tiles,
    qualified,
    reward_amount,
    metrics
  )
  SELECT
    p.tournament_id,
    p.agent_id,
    p.final_rank,
    p.moved_tiles,
    p.qualified,
    CASE WHEN p.qualified THEN v_reward_amount ELSE 0 END,
    jsonb_build_object(
      'rule', 'rank_gte_4_and_moved_tiles_threshold',
      'min_moved_tiles', v_min_moved_tiles,
      'moved_tiles', p.moved_tiles
    )
  FROM prepared p
  ON CONFLICT (tournament_id, agent_id)
  DO UPDATE SET
    final_rank = EXCLUDED.final_rank,
    moved_tiles = EXCLUDED.moved_tiles,
    qualified = EXCLUDED.qualified,
    reward_amount = EXCLUDED.reward_amount,
    metrics = EXCLUDED.metrics,
    updated_at = NOW();

  SELECT COUNT(*), COUNT(*) FILTER (WHERE qualified)
  INTO v_total_rows, v_qualified_rows
  FROM public.tournament_participation
  WHERE tournament_id = p_tournament_id;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', p_tournament_id,
    'participants', v_total_rows,
    'qualified', v_qualified_rows,
    'min_moved_tiles', v_min_moved_tiles,
    'reward_amount', v_reward_amount
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 7) REWARD ISSUANCE + BACKFILL
-- ============================================================================

CREATE OR REPLACE FUNCTION public.issue_tournament_claw_credit_rewards(p_tournament_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_tournament RECORD;
  v_gold INT := 5000;
  v_silver INT := 3000;
  v_bronze INT := 1000;
  v_participation INT := 100;
  v_participation_summary JSONB;
  v_podium_inserted INT := 0;
  v_participation_inserted INT := 0;
BEGIN
  SELECT id, week_number, status
  INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found', 'tournament_id', p_tournament_id);
  END IF;

  IF v_tournament.status <> 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_ended', 'tournament_id', p_tournament_id, 'status', v_tournament.status);
  END IF;

  v_gold := public.claw_credit_setting_int('claw_credit_podium_gold', 5000);
  v_silver := public.claw_credit_setting_int('claw_credit_podium_silver', 3000);
  v_bronze := public.claw_credit_setting_int('claw_credit_podium_bronze', 1000);
  v_participation := public.claw_credit_setting_int('claw_credit_participation_reward', 100);

  v_participation_summary := public.refresh_tournament_participation(p_tournament_id);

  INSERT INTO public.claw_credit_rewards (
    agent_id,
    source_tournament_id,
    source_week_number,
    reward_kind,
    rank,
    amount,
    unlock_week_number,
    source_key
  )
  SELECT
    te.agent_id,
    p_tournament_id,
    v_tournament.week_number,
    CASE te.final_rank
      WHEN 1 THEN 'podium_gold'
      WHEN 2 THEN 'podium_silver'
      WHEN 3 THEN 'podium_bronze'
    END,
    te.final_rank,
    CASE te.final_rank
      WHEN 1 THEN v_gold
      WHEN 2 THEN v_silver
      WHEN 3 THEN v_bronze
    END,
    v_tournament.week_number + 1,
    format('podium:%s:%s:%s', p_tournament_id::TEXT, te.agent_id::TEXT, te.final_rank::TEXT)
  FROM public.tournament_entries te
  JOIN public.agents a ON a.id = te.agent_id
  WHERE te.tournament_id = p_tournament_id
    AND te.final_rank IN (1, 2, 3)
    AND COALESCE(a.is_system, FALSE) = FALSE
  ON CONFLICT (source_key) DO NOTHING;

  GET DIAGNOSTICS v_podium_inserted = ROW_COUNT;

  INSERT INTO public.claw_credit_rewards (
    agent_id,
    source_tournament_id,
    source_week_number,
    reward_kind,
    rank,
    amount,
    unlock_week_number,
    source_key
  )
  SELECT
    tp.agent_id,
    p_tournament_id,
    v_tournament.week_number,
    'participation',
    tp.final_rank,
    v_participation,
    v_tournament.week_number + 1,
    format('participation:%s:%s', p_tournament_id::TEXT, tp.agent_id::TEXT)
  FROM public.tournament_participation tp
  WHERE tp.tournament_id = p_tournament_id
    AND tp.qualified = TRUE
    AND tp.final_rank >= 4
  ON CONFLICT (source_key) DO NOTHING;

  GET DIAGNOSTICS v_participation_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', p_tournament_id,
    'participation', v_participation_summary,
    'podium_rewards_inserted', v_podium_inserted,
    'participation_rewards_inserted', v_participation_inserted
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.backfill_claw_credit_rewards_all()
RETURNS JSONB AS $$
DECLARE
  v_tournament RECORD;
  v_processed INT := 0;
  v_failed INT := 0;
  v_last JSONB := '{}'::jsonb;
BEGIN
  FOR v_tournament IN
    SELECT id
    FROM public.tournaments
    WHERE status = 'ended'
    ORDER BY week_number ASC
  LOOP
    BEGIN
      v_last := public.issue_tournament_claw_credit_rewards(v_tournament.id);
      v_processed := v_processed + 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'processed_tournaments', v_processed,
    'failed_tournaments', v_failed,
    'last_result', v_last
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8) CLAIM + PURCHASE RPCS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_unlocked_claw_credits(
  p_agent_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_started_week INT := 0;
  v_wallet RECORD;
  v_existing_claim RECORD;
  v_claimable_reward_ids UUID[];
  v_claim_count INT := 0;
  v_claim_amount INT := 0;
  v_new_balance BIGINT := 0;
  v_ledger_id UUID;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_idempotency_key');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('claim_claw_credits:' || p_agent_id::TEXT));

  PERFORM public.ensure_claw_credit_wallet(p_agent_id);

  SELECT id, delta, balance_after
  INTO v_existing_claim
  FROM public.claw_credit_ledger
  WHERE agent_id = p_agent_id
    AND idempotency_key = p_idempotency_key
    AND entry_type = 'claim'
  LIMIT 1;

  IF v_existing_claim IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'replay', true,
      'claimed_rewards', 0,
      'credited_amount', GREATEST(0, COALESCE(v_existing_claim.delta, 0)),
      'new_balance', COALESCE(v_existing_claim.balance_after, 0)
    );
  END IF;

  v_started_week := public.current_started_tournament_week();

  SELECT
    ARRAY_AGG(locked.id),
    COUNT(*)::INT,
    COALESCE(SUM(locked.amount), 0)::INT
  INTO v_claimable_reward_ids, v_claim_count, v_claim_amount
  FROM (
    SELECT r.id, r.amount
    FROM public.claw_credit_rewards r
    WHERE r.agent_id = p_agent_id
      AND r.claimed_at IS NULL
      AND r.unlock_week_number <= v_started_week
    FOR UPDATE
  ) AS locked;

  IF v_claim_count <= 0 OR v_claim_amount <= 0 THEN
    SELECT balance INTO v_new_balance
    FROM public.claw_credit_wallets
    WHERE agent_id = p_agent_id;

    RETURN jsonb_build_object(
      'ok', true,
      'replay', false,
      'claimed_rewards', 0,
      'credited_amount', 0,
      'new_balance', COALESCE(v_new_balance, 0),
      'message', 'No claimable Claw Credits yet.'
    );
  END IF;

  SELECT *
  INTO v_wallet
  FROM public.claw_credit_wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  v_new_balance := v_wallet.balance + v_claim_amount;

  UPDATE public.claw_credit_wallets
  SET
    balance = v_new_balance,
    lifetime_earned = lifetime_earned + v_claim_amount
  WHERE agent_id = p_agent_id;

  INSERT INTO public.claw_credit_ledger (
    agent_id,
    delta,
    balance_after,
    entry_type,
    reference_type,
    reference_id,
    note,
    idempotency_key
  )
  VALUES (
    p_agent_id,
    v_claim_amount,
    v_new_balance,
    'claim',
    'reward_claim_batch',
    v_started_week::TEXT,
    format('claimed_rewards=%s', v_claim_count),
    p_idempotency_key
  )
  RETURNING id INTO v_ledger_id;

  UPDATE public.claw_credit_rewards
  SET
    claimed_at = NOW(),
    claim_ledger_entry_id = v_ledger_id
  WHERE id = ANY(v_claimable_reward_ids);

  RETURN jsonb_build_object(
    'ok', true,
    'replay', false,
    'claimed_rewards', v_claim_count,
    'credited_amount', v_claim_amount,
    'new_balance', v_new_balance
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.purchase_tournament_perk_with_claw_credits(
  p_agent_id UUID,
  p_perk_id TEXT,
  p_quantity INT,
  p_idempotency_key TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_tournament RECORD;
  v_wallet RECORD;
  v_loadout RECORD;
  v_purchase RECORD;
  v_new_balance BIGINT;
  v_cost_per_unit INT;
  v_storage_cost INT;
  v_durable_cost INT;
  v_durable_uses INT;
  v_durable_cap INT;
  v_storage_bonus INT;
  v_total_cost INT;
  v_ledger_id UUID;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_idempotency_key');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_quantity');
  END IF;

  IF p_perk_id IS NULL OR p_perk_id NOT IN ('instant_storage', 'durable_axe') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_perk');
  END IF;

  SELECT id, week_number
  INTO v_tournament
  FROM public.tournaments
  WHERE status = 'active'
  ORDER BY starts_at DESC
  LIMIT 1;

  IF v_tournament IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_active_tournament');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.tournament_entries
    WHERE tournament_id = v_tournament.id
      AND agent_id = p_agent_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_enrolled');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('purchase_claw_perk:' || v_tournament.id::TEXT || ':' || p_agent_id::TEXT));

  SELECT * 
  INTO v_purchase
  FROM public.tournament_perk_purchases
  WHERE agent_id = p_agent_id
    AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF v_purchase IS NOT NULL THEN
    SELECT balance
    INTO v_new_balance
    FROM public.claw_credit_wallets
    WHERE agent_id = p_agent_id;

    SELECT *
    INTO v_loadout
    FROM public.tournament_perk_loadouts
    WHERE tournament_id = v_tournament.id
      AND agent_id = p_agent_id;

    RETURN jsonb_build_object(
      'ok', true,
      'replay', true,
      'perk_id', v_purchase.perk_id,
      'quantity', v_purchase.quantity,
      'cost', v_purchase.claw_credit_cost,
      'new_balance', COALESCE(v_new_balance, 0),
      'loadout', jsonb_build_object(
        'storage_bonus_count', COALESCE(v_loadout.storage_bonus_count, 0),
        'durable_axe_uses_remaining', COALESCE(v_loadout.durable_axe_uses_remaining, 0),
        'durable_axe_purchases', COALESCE(v_loadout.durable_axe_purchases, 0)
      )
    );
  END IF;

  PERFORM public.ensure_claw_credit_wallet(p_agent_id);

  SELECT *
  INTO v_wallet
  FROM public.claw_credit_wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  INSERT INTO public.tournament_perk_loadouts (tournament_id, agent_id)
  VALUES (v_tournament.id, p_agent_id)
  ON CONFLICT (tournament_id, agent_id) DO NOTHING;

  SELECT *
  INTO v_loadout
  FROM public.tournament_perk_loadouts
  WHERE tournament_id = v_tournament.id
    AND agent_id = p_agent_id
  FOR UPDATE;

  v_storage_cost := public.claw_credit_setting_int('claw_credit_perk_instant_storage_cost', 1000);
  v_durable_cost := public.claw_credit_setting_int('claw_credit_perk_durable_axe_cost', 500);
  v_durable_uses := public.claw_credit_setting_int('claw_credit_perk_durable_axe_uses', 30);
  v_durable_cap := public.claw_credit_setting_int('claw_credit_perk_durable_axe_purchase_cap', 10);
  v_storage_bonus := public.claw_credit_setting_int('claw_credit_perk_storage_bonus', 500);

  IF p_perk_id = 'instant_storage' THEN
    IF p_quantity <> 1 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'instant_storage_quantity_must_be_one');
    END IF;

    IF COALESCE(v_loadout.storage_bonus_count, 0) >= 1 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'instant_storage_already_purchased');
    END IF;

    v_cost_per_unit := v_storage_cost;
    v_total_cost := v_cost_per_unit;
  ELSE
    IF COALESCE(v_loadout.durable_axe_purchases, 0) + p_quantity > v_durable_cap THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'durable_axe_purchase_cap_reached',
        'purchase_cap', v_durable_cap,
        'current_purchases', COALESCE(v_loadout.durable_axe_purchases, 0)
      );
    END IF;

    v_cost_per_unit := v_durable_cost;
    v_total_cost := v_cost_per_unit * p_quantity;
  END IF;

  IF v_wallet.balance < v_total_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'insufficient_claw_credits',
      'needed', v_total_cost,
      'have', v_wallet.balance
    );
  END IF;

  v_new_balance := v_wallet.balance - v_total_cost;

  UPDATE public.claw_credit_wallets
  SET
    balance = v_new_balance,
    lifetime_spent = lifetime_spent + v_total_cost
  WHERE agent_id = p_agent_id;

  INSERT INTO public.tournament_perk_purchases (
    tournament_id,
    agent_id,
    perk_id,
    quantity,
    claw_credit_cost,
    idempotency_key
  )
  VALUES (
    v_tournament.id,
    p_agent_id,
    p_perk_id,
    p_quantity,
    v_total_cost,
    p_idempotency_key
  )
  RETURNING * INTO v_purchase;

  IF p_perk_id = 'instant_storage' THEN
    UPDATE public.tournament_perk_loadouts
    SET storage_bonus_count = storage_bonus_count + 1
    WHERE tournament_id = v_tournament.id
      AND agent_id = p_agent_id;
  ELSE
    UPDATE public.tournament_perk_loadouts
    SET
      durable_axe_purchases = durable_axe_purchases + p_quantity,
      durable_axe_uses_remaining = durable_axe_uses_remaining + (p_quantity * v_durable_uses)
    WHERE tournament_id = v_tournament.id
      AND agent_id = p_agent_id;
  END IF;

  INSERT INTO public.claw_credit_ledger (
    agent_id,
    delta,
    balance_after,
    entry_type,
    reference_type,
    reference_id,
    note,
    idempotency_key
  )
  VALUES (
    p_agent_id,
    -v_total_cost,
    v_new_balance,
    'perk_purchase',
    'tournament_perk_purchase',
    v_purchase.id::TEXT,
    format('perk=%s;quantity=%s', p_perk_id, p_quantity),
    p_idempotency_key || ':ledger'
  )
  RETURNING id INTO v_ledger_id;

  SELECT *
  INTO v_loadout
  FROM public.tournament_perk_loadouts
  WHERE tournament_id = v_tournament.id
    AND agent_id = p_agent_id;

  RETURN jsonb_build_object(
    'ok', true,
    'replay', false,
    'tournament_id', v_tournament.id,
    'perk_id', p_perk_id,
    'quantity', p_quantity,
    'cost', v_total_cost,
    'new_balance', v_new_balance,
    'storage_bonus_per_stack', v_storage_bonus,
    'durable_axe_uses_per_purchase', v_durable_uses,
    'ledger_entry_id', v_ledger_id,
    'loadout', jsonb_build_object(
      'storage_bonus_count', COALESCE(v_loadout.storage_bonus_count, 0),
      'durable_axe_uses_remaining', COALESCE(v_loadout.durable_axe_uses_remaining, 0),
      'durable_axe_purchases', COALESCE(v_loadout.durable_axe_purchases, 0)
    )
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9) SCORE CUTOFF HARDENING (use ends_at window)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_tournament_score(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  agent_record RECORD;
  base_score INT := 0;
  forum_bonus DECIMAL := 0;
  final_score INT := 0;
  upvotes_this_tournament INT := 0;
  strategy_posts INT := 0;
  trade_posts INT := 0;
  diplomacy_posts INT := 0;
  current_territories INT := 0;
  trades_this_tournament INT := 0;
  current_gathered INT := 0;
  current_wealth INT := 0;
  v_storage_count INT := 0;
  v_workshop_count INT := 0;
  v_fortification_count INT := 0;
  terrain_diversity INT := 0;
  buildings_count INT := 0;
  held_tiles INT := 0;
  upgrade_overages INT := 0;
  craft_events INT := 0;
  distinct_craft_items INT := 0;
  build_events INT := 0;
  move_events INT := 0;
  claim_events INT := 0;
  upgrade_events INT := 0;
BEGIN
  SELECT * INTO t_record FROM public.tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN RETURN 0; END IF;

  SELECT * INTO entry FROM public.tournament_entries
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  IF entry IS NULL THEN RETURN 0; END IF;

  SELECT * INTO agent_record FROM public.agents WHERE id = p_agent_id;
  IF agent_record IS NULL THEN RETURN 0; END IF;

  -- Current territory + building counts
  SELECT COUNT(*) INTO current_territories FROM public.tiles WHERE owner_id = p_agent_id;

  SELECT
    COUNT(*) FILTER (WHERE building_type = 'storage'),
    COUNT(*) FILTER (WHERE building_type = 'workshop'),
    COUNT(*) FILTER (WHERE building_type = 'fortification')
  INTO v_storage_count, v_workshop_count, v_fortification_count
  FROM public.tiles
  WHERE owner_id = p_agent_id AND building_type IS NOT NULL;

  -- Wealth (tournament variant excludes food)
  current_wealth := public.calculate_sqrt_tournament_wealth(
    agent_record.gold,
    agent_record.wood,
    agent_record.stone,
    v_storage_count,
    v_workshop_count,
    v_fortification_count,
    current_territories
  );

  -- Gathered total since reset
  current_gathered := COALESCE(agent_record.total_gathered_gold, 0) +
                      COALESCE(agent_record.total_gathered_wood, 0) +
                      COALESCE(agent_record.total_gathered_food, 0) +
                      COALESCE(agent_record.total_gathered_stone, 0);

  -- Direct trades during tournament window (hard cutoff at ends_at)
  SELECT COUNT(*) INTO trades_this_tournament
  FROM public.trades
  WHERE (from_agent_id = p_agent_id OR to_agent_id = p_agent_id)
    AND status = 'accepted'
    AND created_at >= t_record.starts_at
    AND created_at <= t_record.ends_at;

  -- Forum thread/post counts in tournament window
  SELECT
    COUNT(*) FILTER (WHERE category = 'strategy'),
    COUNT(*) FILTER (WHERE category = 'trade'),
    COUNT(*) FILTER (WHERE category = 'diplomacy')
  INTO strategy_posts, trade_posts, diplomacy_posts
  FROM public.forum_threads
  WHERE author_id = p_agent_id
    AND created_at >= t_record.starts_at
    AND created_at <= t_record.ends_at;

  -- Upvotes received in tournament window based on forum_votes timestamps (hard cutoff).
  SELECT COALESCE(COUNT(*), 0)::INT
  INTO upvotes_this_tournament
  FROM public.forum_votes fv
  LEFT JOIN public.forum_threads ft ON ft.id = fv.thread_id
  LEFT JOIN public.forum_posts fp ON fp.id = fv.post_id
  WHERE fv.created_at >= t_record.starts_at
    AND fv.created_at <= t_record.ends_at
    AND (
      (ft.id IS NOT NULL AND ft.author_id = p_agent_id)
      OR (fp.id IS NOT NULL AND fp.author_id = p_agent_id)
    );

  -- Event stats during tournament window (hard cutoff at ends_at)
  SELECT
    COUNT(*) FILTER (WHERE e.type = 'craft'),
    COUNT(DISTINCT CASE WHEN e.type = 'craft' THEN e.data->>'item_id' END),
    COUNT(*) FILTER (WHERE e.type = 'build')
  INTO craft_events, distinct_craft_items, build_events
  FROM public.events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.created_at <= t_record.ends_at
    AND e.type IN ('craft', 'build');

  SELECT
    COUNT(*) FILTER (WHERE e.type = 'move'),
    COUNT(*) FILTER (WHERE e.type = 'claim'),
    COUNT(*) FILTER (WHERE e.type = 'upgrade')
  INTO move_events, claim_events, upgrade_events
  FROM public.events e
  WHERE e.agent_id = p_agent_id
    AND e.created_at >= t_record.starts_at
    AND e.created_at <= t_record.ends_at
    AND e.type IN ('move', 'claim', 'upgrade');

  CASE t_record.type
    WHEN 'wealth_sprint' THEN
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_tournament * 0.05, 0.50);

    WHEN 'territory_conqueror' THEN
      -- Territory points:
      -- 1/tile + upgrade levels + 2/building + 3/unique terrain + hold bonus + strategy posts (max 10)
      SELECT
        COALESCE(SUM(1 + GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0),
        COUNT(DISTINCT t.terrain),
        COALESCE(SUM(CASE WHEN t.building_type IS NOT NULL THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN t.claimed_at <= LEAST(NOW(), t_record.ends_at) - INTERVAL '2 hours' THEN 1 ELSE 0 END), 0)
      INTO current_territories, terrain_diversity, buildings_count, held_tiles
      FROM public.tiles t
      WHERE t.owner_id = p_agent_id;

      base_score := current_territories
                  + (buildings_count * 2)
                  + (terrain_diversity * 3)
                  + held_tiles
                  + LEAST(strategy_posts, 10);
      forum_bonus := 0;

    WHEN 'master_gatherer' THEN
      base_score := GREATEST(0, current_gathered - entry.starting_gathered);
      forum_bonus := LEAST(upvotes_this_tournament * 0.10, 0.50);

    WHEN 'architect_cup' THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE(t.upgrade_level, 1) - 1)), 0)
      INTO upgrade_overages
      FROM public.tiles t
      WHERE t.owner_id = p_agent_id;

      base_score := (v_storage_count * 8)
                  + (v_workshop_count * 14)
                  + (v_fortification_count * 11)
                  + (upgrade_overages * 3);
      forum_bonus := 0;

    WHEN 'crafting_maestro' THEN
      base_score := (craft_events * 2)
                  + (distinct_craft_items * 10)
                  + (build_events * 4);
      forum_bonus := 0;

    WHEN 'trailblazer' THEN
      base_score := move_events
                  + (claim_events * 12)
                  + (upgrade_events * 8);
      forum_bonus := 0;

    WHEN 'trade_baron' THEN
      base_score := trades_this_tournament + trade_posts;
      forum_bonus := 0;

    WHEN 'forum_champion' THEN
      base_score := upvotes_this_tournament + (diplomacy_posts * upvotes_this_tournament);
      forum_bonus := 0;

    ELSE
      base_score := 0;
      forum_bonus := 0;
  END CASE;

  final_score := GREATEST(0, ROUND(base_score * (1 + forum_bonus)));

  UPDATE public.tournament_entries
  SET current_score = final_score,
      forum_bonus_percent = ROUND(forum_bonus * 100),
      updated_at = NOW()
  WHERE tournament_id = p_tournament_id
    AND agent_id = p_agent_id;

  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.calculate_tournament_score(UUID, UUID) IS
'Tournament scoring with strict ends_at cutoff for trades/forum/events so no post-deadline actions can influence final rank.';

-- ============================================================================
-- 10) FINALIZATION OVERRIDE (issue rewards automatically)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.finalize_tournament(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  current_rank INT := 0;
BEGIN
  SELECT * INTO t_record FROM public.tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL OR t_record.status = 'ended' THEN RETURN; END IF;

  PERFORM public.update_tournament_scores(p_tournament_id);

  FOR entry IN
    SELECT te.id, te.agent_id, te.current_score
    FROM public.tournament_entries te
    WHERE te.tournament_id = p_tournament_id
    ORDER BY te.current_score DESC, te.joined_at ASC
  LOOP
    current_rank := current_rank + 1;

    UPDATE public.tournament_entries
    SET final_rank = current_rank
    WHERE id = entry.id;

    IF current_rank <= 3 THEN
      INSERT INTO public.tournament_winners (tournament_id, agent_id, rank, final_score, tournament_type)
      VALUES (p_tournament_id, entry.agent_id, current_rank, entry.current_score, t_record.type)
      ON CONFLICT (tournament_id, rank) DO NOTHING;
    END IF;
  END LOOP;

  UPDATE public.tournaments
  SET status = 'ended'
  WHERE id = p_tournament_id;

  -- Issue Claw Credits rewards (idempotent if finalize is retried).
  PERFORM public.issue_tournament_claw_credit_rewards(p_tournament_id);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.finalize_tournament(UUID) IS
'Finalize tournament, persist podium ranks/winners, mark ended, and issue Claw Credits rewards (podium + participation).';

-- ============================================================================
-- 11) PUBLIC VIEWS FOR UI
-- ============================================================================

CREATE OR REPLACE VIEW public.claw_credit_leaderboard AS
SELECT
  a.id AS agent_id,
  a.name AS agent_name,
  COALESCE(w.balance, 0) AS claw_credits,
  COALESCE(w.lifetime_earned, 0) AS lifetime_earned,
  COALESCE(w.lifetime_spent, 0) AS lifetime_spent,
  COUNT(*) FILTER (WHERE tw.rank = 1) AS gold_medals,
  COUNT(*) FILTER (WHERE tw.rank = 2) AS silver_medals,
  COUNT(*) FILTER (WHERE tw.rank = 3) AS bronze_medals
FROM public.agents a
LEFT JOIN public.claw_credit_wallets w ON w.agent_id = a.id
LEFT JOIN public.tournament_winners tw ON tw.agent_id = a.id
WHERE COALESCE(a.is_system, FALSE) = FALSE
GROUP BY a.id, a.name, w.balance, w.lifetime_earned, w.lifetime_spent
ORDER BY claw_credits DESC, lifetime_earned DESC, a.name ASC;

GRANT SELECT ON public.claw_credit_leaderboard TO anon;
GRANT SELECT ON public.claw_credit_leaderboard TO authenticated;

GRANT SELECT ON public.tournament_participation TO anon;
GRANT SELECT ON public.tournament_participation TO authenticated;

-- ============================================================================
-- 12) RPC GRANTS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_active_tournament_storage_bonus(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_tournament_storage_bonus(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_tournament_durable_axe_uses(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_active_tournament_durable_axe_uses(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_durable_axe_use(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.consume_durable_axe_use(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_unlocked_claw_credits(UUID, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.claim_unlocked_claw_credits(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_tournament_perk_with_claw_credits(UUID, TEXT, INT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.purchase_tournament_perk_with_claw_credits(UUID, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_tournament_participation(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.refresh_tournament_participation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_tournament_claw_credit_rewards(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.issue_tournament_claw_credit_rewards(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_claw_credit_rewards_all() TO anon;
GRANT EXECUTE ON FUNCTION public.backfill_claw_credit_rewards_all() TO authenticated;

-- ============================================================================
-- 13) RETROACTIVE BACKFILL (IDEMPOTENT)
-- ============================================================================

SELECT public.backfill_claw_credit_rewards_all();
