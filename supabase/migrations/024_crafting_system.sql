-- ============================================================================
-- CRAFTING & ITEM SYSTEM
-- Adds agent_items table for tracking owned items, tools, and equipment
-- ============================================================================

-- Agent items inventory table
CREATE TABLE IF NOT EXISTS agent_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,           -- References item definitions in code (e.g. 'wooden_pickaxe')
  quantity INTEGER NOT NULL DEFAULT 1,
  uses_remaining INTEGER,          -- NULL = permanent/unlimited, 0 = consumed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,          -- NULL = never expires

  -- An agent can only have one row per item type
  UNIQUE(agent_id, item_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_agent_items_agent_id ON agent_items(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_items_item_id ON agent_items(item_id);

-- Add crafting cooldown column to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_craft_at TIMESTAMPTZ;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE agent_items ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY "service_role_all_agent_items"
  ON agent_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Agents can read their own items (via API, not direct access)
CREATE POLICY "agents_read_own_items"
  ON agent_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ============================================================================
-- HELPER FUNCTION: Get agent items (for use in gather/claim routes)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_agent_items(p_agent_id UUID)
RETURNS TABLE(
  id UUID,
  item_id TEXT,
  quantity INTEGER,
  uses_remaining INTEGER,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT ai.id, ai.item_id, ai.quantity, ai.uses_remaining, ai.created_at, ai.expires_at
  FROM agent_items ai
  WHERE ai.agent_id = p_agent_id
    AND ai.quantity > 0
    AND (ai.uses_remaining IS NULL OR ai.uses_remaining > 0)
    AND (ai.expires_at IS NULL OR ai.expires_at > NOW());
END;
$$ LANGUAGE plpgsql;
