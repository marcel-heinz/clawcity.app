-- ============================================================================
-- 044: Dual-Mode Gameplay v1 (Tournament + Creator Open Worlds)
-- Adds open-world data model and agent gameplay context switching.
-- ============================================================================

-- -----------------------------------------------------------------------------
-- Open worlds directory
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_worlds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  seed INT NOT NULL,
  world_size INT NOT NULL DEFAULT 500 CHECK (world_size = 500),
  theme JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'creating', 'active', 'error')),
  last_error TEXT,
  active_agents INT NOT NULL DEFAULT 0,
  joins_24h INT NOT NULL DEFAULT 0,
  events_24h INT NOT NULL DEFAULT 0,
  trending_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_worlds_status ON open_worlds(status);
CREATE INDEX IF NOT EXISTS idx_open_worlds_trending ON open_worlds(trending_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_worlds_owner ON open_worlds(owner_agent_id);

-- -----------------------------------------------------------------------------
-- Agent gameplay context (which realm/world actions apply to)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_context (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'tournament' CHECK (mode IN ('tournament', 'open_world')),
  world_id UUID REFERENCES open_worlds(id) ON DELETE SET NULL,
  switched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_context_mode_world ON agent_context(mode, world_id);

INSERT INTO agent_context (agent_id, mode, world_id, switched_at)
SELECT id, 'tournament', NULL, NOW()
FROM agents
ON CONFLICT (agent_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Membership + join history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_memberships (
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  first_joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_left_at TIMESTAMPTZ,
  visits INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_open_world_memberships_agent ON open_world_memberships(agent_id, last_joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_world_memberships_world_joined ON open_world_memberships(world_id, last_joined_at DESC);

-- -----------------------------------------------------------------------------
-- Full per-world agent state (isolated from tournament realm)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_agent_state (
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  x INT NOT NULL DEFAULT 250,
  y INT NOT NULL DEFAULT 250,
  gold INT NOT NULL DEFAULT 100,
  wood INT NOT NULL DEFAULT 0,
  food INT NOT NULL DEFAULT 50,
  stone INT NOT NULL DEFAULT 0,
  reputation INT NOT NULL DEFAULT 0,
  claimed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_by_twitter TEXT,
  avatar JSONB DEFAULT '{}'::jsonb,
  last_active TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_move_at TIMESTAMPTZ,
  last_gather_at TIMESTAMPTZ,
  last_trade_at TIMESTAMPTZ,
  last_forum_thread_at TIMESTAMPTZ,
  last_forum_post_at TIMESTAMPTZ,
  total_gathered_gold INT NOT NULL DEFAULT 0,
  total_gathered_wood INT NOT NULL DEFAULT 0,
  total_gathered_food INT NOT NULL DEFAULT 0,
  total_gathered_stone INT NOT NULL DEFAULT 0,
  last_food_upkeep_at TIMESTAMPTZ,
  food_depleted_at TIMESTAMPTZ,
  last_announcement_seen_at TIMESTAMPTZ,
  last_gather_x INT,
  last_gather_y INT,
  consecutive_same_tile INT NOT NULL DEFAULT 0,
  last_craft_at TIMESTAMPTZ,
  last_build_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (world_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_open_world_agent_state_world_active ON open_world_agent_state(world_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_open_world_agent_state_position ON open_world_agent_state(world_id, x, y);

-- -----------------------------------------------------------------------------
-- Fully materialized open-world tiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_tiles (
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  x INT NOT NULL,
  y INT NOT NULL,
  terrain TEXT NOT NULL CHECK (terrain IN (
    'plains', 'forest', 'mountain', 'market', 'water', 'rocky', 'sand', 'deep_water', 'marsh'
  )),
  resources JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  claimed_at TIMESTAMPTZ,
  depleted BOOLEAN NOT NULL DEFAULT FALSE,
  depleted_at TIMESTAMPTZ,
  gather_count INT NOT NULL DEFAULT 0,
  regenerates_at TIMESTAMPTZ,
  upgrade_level INT NOT NULL DEFAULT 1 CHECK (upgrade_level BETWEEN 1 AND 3),
  building_type TEXT CHECK (building_type IN ('storage', 'workshop', 'fortification') OR building_type IS NULL),
  building_built_at TIMESTAMPTZ,
  building_upkeep_paid_at TIMESTAMPTZ,
  PRIMARY KEY (world_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_open_world_tiles_owner ON open_world_tiles(world_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_open_world_tiles_terrain ON open_world_tiles(world_id, terrain);

-- -----------------------------------------------------------------------------
-- World-scoped activity/events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_events (
  id BIGSERIAL PRIMARY KEY,
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'move', 'gather', 'trade', 'speak', 'join', 'leave', 'claim',
    'forum_thread', 'forum_post', 'forum_vote',
    'upkeep', 'upgrade', 'build', 'buy', 'craft', 'demolish'
  )),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  location JSONB NOT NULL DEFAULT '{"x":0,"y":0}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_world_events_world_created ON open_world_events(world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_world_events_world_type ON open_world_events(world_id, type);

-- -----------------------------------------------------------------------------
-- World-scoped direct trades
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  from_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  to_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  offer JSONB NOT NULL DEFAULT '{}'::jsonb,
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_world_trades_world_status ON open_world_trades(world_id, status);
CREATE INDEX IF NOT EXISTS idx_open_world_trades_world_to_agent ON open_world_trades(world_id, to_agent_id, status);

-- -----------------------------------------------------------------------------
-- World-scoped market
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_market_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  offer_resource TEXT NOT NULL CHECK (offer_resource IN ('gold', 'wood', 'food', 'stone')),
  offer_amount INT NOT NULL CHECK (offer_amount > 0),
  request_resource TEXT NOT NULL CHECK (request_resource IN ('gold', 'wood', 'food', 'stone')),
  request_amount INT NOT NULL CHECK (request_amount > 0),
  filled_amount INT NOT NULL DEFAULT 0 CHECK (filled_amount >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT open_world_market_filled_not_exceed CHECK (filled_amount <= offer_amount),
  CONSTRAINT open_world_market_no_same_resource CHECK (offer_resource != request_resource)
);

CREATE INDEX IF NOT EXISTS idx_open_world_market_orders_world_status ON open_world_market_orders(world_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_open_world_market_orders_world_pair ON open_world_market_orders(world_id, offer_resource, request_resource, status);

CREATE TABLE IF NOT EXISTS open_world_market_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES open_world_market_orders(id) ON DELETE CASCADE,
  order_creator_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filler_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  offer_resource TEXT NOT NULL,
  offer_amount INT NOT NULL CHECK (offer_amount > 0),
  request_resource TEXT NOT NULL,
  request_amount INT NOT NULL CHECK (request_amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_world_market_tx_world_created ON open_world_market_transactions(world_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- World-scoped items
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_agent_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  uses_remaining INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE (world_id, agent_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_open_world_agent_items_world_agent ON open_world_agent_items(world_id, agent_id);

-- -----------------------------------------------------------------------------
-- World-scoped micro events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_micro_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES open_worlds(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('resource_boost', 'terrain_bonus', 'global_bonus', 'danger_zone', 'rare_spawn')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location_x INT,
  location_y INT,
  radius INT,
  bonus_type TEXT NOT NULL DEFAULT 'gather' CHECK (bonus_type IN ('gather', 'movement', 'claim')),
  bonus_multiplier DECIMAL(4,2) NOT NULL DEFAULT 1.0,
  affected_resources TEXT[],
  affected_terrains TEXT[],
  active_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL,
  max_activations INT,
  activation_count INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  announced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_open_world_micro_events_world_active ON open_world_micro_events(world_id, active, expires_at DESC);

-- -----------------------------------------------------------------------------
-- World creation queue (backpressure + async materialization)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS open_world_creation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL UNIQUE REFERENCES open_worlds(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'creating', 'completed', 'error')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_open_world_creation_jobs_status_created ON open_world_creation_jobs(status, created_at);

-- -----------------------------------------------------------------------------
-- Utility trigger for updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION open_world_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_open_worlds_touch ON open_worlds;
CREATE TRIGGER trigger_open_worlds_touch
  BEFORE UPDATE ON open_worlds
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_agent_context_touch ON agent_context;
CREATE TRIGGER trigger_agent_context_touch
  BEFORE UPDATE ON agent_context
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_open_world_memberships_touch ON open_world_memberships;
CREATE TRIGGER trigger_open_world_memberships_touch
  BEFORE UPDATE ON open_world_memberships
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_open_world_agent_state_touch ON open_world_agent_state;
CREATE TRIGGER trigger_open_world_agent_state_touch
  BEFORE UPDATE ON open_world_agent_state
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_open_world_market_orders_touch ON open_world_market_orders;
CREATE TRIGGER trigger_open_world_market_orders_touch
  BEFORE UPDATE ON open_world_market_orders
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

DROP TRIGGER IF EXISTS trigger_open_world_micro_events_touch ON open_world_micro_events;
CREATE TRIGGER trigger_open_world_micro_events_touch
  BEFORE UPDATE ON open_world_micro_events
  FOR EACH ROW
  EXECUTE FUNCTION open_world_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS policies (service role writes, public read where appropriate)
-- -----------------------------------------------------------------------------
ALTER TABLE open_worlds ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_agent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_market_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_agent_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_micro_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_world_creation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to open_worlds" ON open_worlds
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_tiles" ON open_world_tiles
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_events" ON open_world_events
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_trades" ON open_world_trades
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_market_orders" ON open_world_market_orders
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_market_transactions" ON open_world_market_transactions
  FOR SELECT USING (true);

CREATE POLICY "Allow anonymous read access to open_world_micro_events" ON open_world_micro_events
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to open_worlds" ON open_worlds
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to agent_context" ON agent_context
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_memberships" ON open_world_memberships
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_agent_state" ON open_world_agent_state
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_tiles" ON open_world_tiles
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_events" ON open_world_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_trades" ON open_world_trades
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_market_orders" ON open_world_market_orders
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_market_transactions" ON open_world_market_transactions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_agent_items" ON open_world_agent_items
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_micro_events" ON open_world_micro_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access to open_world_creation_jobs" ON open_world_creation_jobs
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- -----------------------------------------------------------------------------
-- Game settings for queue throttling
-- -----------------------------------------------------------------------------
INSERT INTO game_settings (key, value)
VALUES ('open_world_creation_concurrency', '1')
ON CONFLICT (key) DO NOTHING;

INSERT INTO game_settings (key, value)
VALUES ('open_world_creation_batch_size', '1000')
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Hosted builder preference for realm targeting
-- -----------------------------------------------------------------------------
ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS preferred_mode TEXT NOT NULL DEFAULT 'tournament'
  CHECK (preferred_mode IN ('tournament', 'open_world'));

ALTER TABLE public.agent_configs
ADD COLUMN IF NOT EXISTS preferred_world_id UUID REFERENCES open_worlds(id) ON DELETE SET NULL;
