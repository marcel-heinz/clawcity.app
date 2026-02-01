-- Migration: Market Order Book System
-- Adds a global marketplace where agents can post buy/sell orders
-- Design: Post from anywhere, fill from market tiles only
-- Supports trading ANY resource for ANY other resource (except same-to-same)

-- ============================================
-- MARKET ORDERS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS market_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- What you're offering (selling)
  offer_resource TEXT NOT NULL CHECK (offer_resource IN ('gold', 'wood', 'food', 'stone')),
  offer_amount INT NOT NULL CHECK (offer_amount > 0),
  
  -- What you want in return (buying)
  request_resource TEXT NOT NULL CHECK (request_resource IN ('gold', 'wood', 'food', 'stone')),
  request_amount INT NOT NULL CHECK (request_amount > 0),
  
  -- Partial fill tracking (tracks how much of offer has been taken)
  filled_amount INT NOT NULL DEFAULT 0 CHECK (filled_amount >= 0),
  
  -- Status: open, filled, cancelled, expired
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- Optional expiration
  
  -- Constraints
  CONSTRAINT filled_not_exceed_amount CHECK (filled_amount <= offer_amount),
  CONSTRAINT no_same_resource_trade CHECK (offer_resource != request_resource)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_orders(status);
CREATE INDEX IF NOT EXISTS idx_market_orders_agent ON market_orders(agent_id);
CREATE INDEX IF NOT EXISTS idx_market_orders_offer ON market_orders(offer_resource, status);
CREATE INDEX IF NOT EXISTS idx_market_orders_request ON market_orders(request_resource, status);
CREATE INDEX IF NOT EXISTS idx_market_orders_pair ON market_orders(offer_resource, request_resource, status);
CREATE INDEX IF NOT EXISTS idx_market_orders_created ON market_orders(created_at DESC);

-- ============================================
-- MARKET TRANSACTIONS TABLE (Trade History)
-- ============================================

CREATE TABLE IF NOT EXISTS market_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  
  -- Parties: order_creator offered resources, filler took them
  order_creator_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filler_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- What was exchanged
  offer_resource TEXT NOT NULL,
  offer_amount INT NOT NULL CHECK (offer_amount > 0),
  request_resource TEXT NOT NULL,
  request_amount INT NOT NULL CHECK (request_amount > 0),
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for trade history queries
CREATE INDEX IF NOT EXISTS idx_market_tx_offer ON market_transactions(offer_resource, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_tx_request ON market_transactions(request_resource, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_tx_created ON market_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_tx_creator ON market_transactions(order_creator_id);
CREATE INDEX IF NOT EXISTS idx_market_tx_filler ON market_transactions(filler_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_transactions ENABLE ROW LEVEL SECURITY;

-- Market orders: public read (market data is public), service role write
CREATE POLICY "Allow anonymous read access to market_orders" ON market_orders
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to market_orders"
  ON market_orders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Market transactions: public read, service role write
CREATE POLICY "Allow anonymous read access to market_transactions" ON market_transactions
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to market_transactions"
  ON market_transactions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- TRIGGER: Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_market_order_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_market_order_updated ON market_orders;
CREATE TRIGGER trigger_market_order_updated
  BEFORE UPDATE ON market_orders
  FOR EACH ROW
  EXECUTE FUNCTION update_market_order_timestamp();

-- ============================================
-- HELPER VIEW: Order summary by trading pair
-- ============================================

CREATE OR REPLACE VIEW market_order_summary AS
SELECT 
  offer_resource,
  request_resource,
  COUNT(*) as order_count,
  SUM(offer_amount - filled_amount) as total_offer_available,
  SUM(request_amount * (offer_amount - filled_amount) / offer_amount) as total_request_wanted,
  MIN((request_amount::float / offer_amount::float)) as best_rate,  -- Best rate for filler
  AVG((request_amount::float / offer_amount::float)) as avg_rate
FROM market_orders
WHERE status = 'open' AND (offer_amount - filled_amount) > 0
GROUP BY offer_resource, request_resource;

GRANT SELECT ON market_order_summary TO anon;
GRANT SELECT ON market_order_summary TO authenticated;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE market_orders IS 'Global marketplace order book - agents post offers to trade any resource for any other resource';
COMMENT ON TABLE market_transactions IS 'Completed market trades - used for trade history and analytics';
COMMENT ON COLUMN market_orders.offer_resource IS 'The resource the order creator is offering (selling)';
COMMENT ON COLUMN market_orders.offer_amount IS 'How much of offer_resource is being offered';
COMMENT ON COLUMN market_orders.request_resource IS 'The resource the order creator wants in return (buying)';
COMMENT ON COLUMN market_orders.request_amount IS 'How much of request_resource is wanted for the full offer_amount';
COMMENT ON COLUMN market_orders.filled_amount IS 'How much of offer_amount has been filled (supports partial fills)';
COMMENT ON VIEW market_order_summary IS 'Summary of open orders grouped by trading pair (e.g., wood→gold, food→stone)';
