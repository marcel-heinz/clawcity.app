-- ============================================================================
-- 034: User Accounts, Hosted Agent Configs, and Decision Logging
-- Supports non-tech onboarding: Google Auth -> Agent Builder -> Hosted Worker
-- ============================================================================

-- ============================================================================
-- 1. USERS TABLE
-- Links to Supabase auth.users, stores subscription tier and Stripe IDs
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  -- Subscription tier
  tier text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro')),
  -- Stripe integration
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  -- Tier limits (auto-set by trigger)
  max_agents integer NOT NULL DEFAULT 0,
  max_decisions_per_day integer NOT NULL DEFAULT 0,
  -- Usage tracking
  decisions_used_today integer NOT NULL DEFAULT 0,
  decisions_reset_at timestamptz NOT NULL DEFAULT now(),
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users(stripe_customer_id);

-- ============================================================================
-- 2. AGENT CONFIGS TABLE
-- No-code builder output: personality, strategy, custom prompt, runtime state
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Agent identity
  agent_name text NOT NULL,
  agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  -- Encrypted API key for the worker to act as this agent
  agent_api_key_encrypted text,
  -- Builder configuration
  personality_preset text NOT NULL DEFAULT 'explorer' CHECK (personality_preset IN ('trader', 'explorer', 'gatherer', 'social', 'warrior', 'custom')),
  -- Strategy sliders (0-100)
  strategy_exploration integer NOT NULL DEFAULT 50 CHECK (strategy_exploration BETWEEN 0 AND 100),
  strategy_trading integer NOT NULL DEFAULT 50 CHECK (strategy_trading BETWEEN 0 AND 100),
  strategy_aggression integer NOT NULL DEFAULT 50 CHECK (strategy_aggression BETWEEN 0 AND 100),
  strategy_social integer NOT NULL DEFAULT 50 CHECK (strategy_social BETWEEN 0 AND 100),
  -- Custom instructions from user
  custom_instructions text DEFAULT '',
  -- Runtime state
  is_active boolean NOT NULL DEFAULT false,
  last_tick_at timestamptz,
  last_state_hash text,
  -- Error tracking
  consecutive_errors integer NOT NULL DEFAULT 0,
  last_error text,
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for worker: fetch all active configs
CREATE INDEX IF NOT EXISTS idx_agent_configs_active ON public.agent_configs(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_agent_configs_user ON public.agent_configs(user_id);

-- ============================================================================
-- 3. DECISION LOG TABLE
-- Audit trail for every worker decision (action, tokens, cost, success)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.decision_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_config_id uuid NOT NULL REFERENCES public.agent_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Decision details
  action text NOT NULL,
  action_data jsonb DEFAULT '{}',
  reasoning text,
  -- Source: 'rule_engine' or 'llm'
  decision_source text NOT NULL DEFAULT 'llm' CHECK (decision_source IN ('rule_engine', 'llm')),
  -- LLM usage tracking
  model text,
  prompt_tokens integer DEFAULT 0,
  completion_tokens integer DEFAULT 0,
  estimated_cost_usd numeric(10,6) DEFAULT 0,
  -- Execution result
  success boolean NOT NULL DEFAULT false,
  error_message text,
  -- Game state snapshot
  agent_position jsonb,
  -- Timestamp
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for user dashboard queries
CREATE INDEX IF NOT EXISTS idx_decision_log_config ON public.decision_log(agent_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_log_user ON public.decision_log(user_id, created_at DESC);

-- ============================================================================
-- 4. TRIGGERS
-- ============================================================================

-- Auto-create users row when a new auth.users record is inserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update tier limits when tier changes
CREATE OR REPLACE FUNCTION public.update_tier_limits()
RETURNS trigger AS $$
BEGIN
  IF NEW.tier = 'free' THEN
    NEW.max_agents := 0;
    NEW.max_decisions_per_day := 0;
  ELSIF NEW.tier = 'starter' THEN
    NEW.max_agents := 1;
    NEW.max_decisions_per_day := 200;
  ELSIF NEW.tier = 'pro' THEN
    NEW.max_agents := 1;
    NEW.max_decisions_per_day := 800;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_user_tier_change ON public.users;
CREATE TRIGGER on_user_tier_change
  BEFORE UPDATE OF tier ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_tier_limits();

-- Auto-update updated_at on agent_configs
CREATE OR REPLACE FUNCTION public.update_agent_config_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_agent_config_update ON public.agent_configs;
CREATE TRIGGER on_agent_config_update
  BEFORE UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_agent_config_timestamp();

-- ============================================================================
-- 5. DAILY DECISION RESET FUNCTION (called by cron)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reset_daily_decisions()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET decisions_used_today = 0,
      decisions_reset_at = now()
  WHERE decisions_used_today > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 6. INCREMENT DECISIONS RPC (atomic counter for worker)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.increment_decisions(user_id_input uuid)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET decisions_used_today = decisions_used_today + 1
  WHERE id = user_id_input;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 7. ROW-LEVEL SECURITY
-- ============================================================================

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_log ENABLE ROW LEVEL SECURITY;

-- Users: can read/update own row
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Agent configs: users can CRUD their own
CREATE POLICY "Users can view own configs" ON public.agent_configs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create configs" ON public.agent_configs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own configs" ON public.agent_configs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own configs" ON public.agent_configs
  FOR DELETE USING (auth.uid() = user_id);

-- Decision log: users can view their own
CREATE POLICY "Users can view own decisions" ON public.decision_log
  FOR SELECT USING (auth.uid() = user_id);

-- Service role bypasses RLS automatically
