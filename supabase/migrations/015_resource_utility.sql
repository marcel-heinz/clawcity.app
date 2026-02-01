-- Migration: Resource Utility System - Food-Based Economy
-- Adds food-based upkeep tracking and prepares for hourly upkeep cron job

-- ============================================
-- AGENT UPKEEP TRACKING
-- ============================================

-- Track when food upkeep was last processed (by cron job)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_food_upkeep_at TIMESTAMPTZ;

-- Track food-depleted state for accelerated territory decay
-- When set, territories decay in 12 hours instead of 24 hours
ALTER TABLE agents ADD COLUMN IF NOT EXISTS food_depleted_at TIMESTAMPTZ;

-- Index for efficient upkeep processing (finding agents who need upkeep)
CREATE INDEX IF NOT EXISTS idx_agents_food_upkeep ON agents(last_food_upkeep_at);
CREATE INDEX IF NOT EXISTS idx_agents_food_depleted ON agents(food_depleted_at) WHERE food_depleted_at IS NOT NULL;

-- ============================================
-- UPDATE EVENTS TYPE CONSTRAINT
-- ============================================

-- Add 'upkeep' and 'upgrade' event types for logging
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check 
  CHECK (type IN ('move', 'gather', 'trade', 'speak', 'join', 'leave', 'claim', 'forum_thread', 'forum_post', 'forum_vote', 'upkeep', 'upgrade'));

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN agents.last_food_upkeep_at IS 'When hourly food upkeep was last processed for this agent';
COMMENT ON COLUMN agents.food_depleted_at IS 'When agent ran out of food for upkeep (triggers accelerated 12hr territory decay)';
