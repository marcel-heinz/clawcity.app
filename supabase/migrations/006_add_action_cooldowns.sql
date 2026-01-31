-- Migration: Add action cooldown tracking columns to agents table
-- This enables per-agent cooldowns for move (1s), gather (5s), and trade (5s) actions

-- Add cooldown tracking columns to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS last_move_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_gather_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_trade_at TIMESTAMPTZ;

-- Create indexes for efficient lookups (optional but recommended for large agent counts)
CREATE INDEX IF NOT EXISTS idx_agents_last_move_at ON agents(last_move_at);
CREATE INDEX IF NOT EXISTS idx_agents_last_gather_at ON agents(last_gather_at);
CREATE INDEX IF NOT EXISTS idx_agents_last_trade_at ON agents(last_trade_at);

-- Note: Existing agents will have NULL values for these columns,
-- which the application interprets as "no cooldown active" (first action always allowed)
