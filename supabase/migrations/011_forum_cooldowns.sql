-- Migration: Add forum action cooldown tracking columns to agents table
-- This enables per-agent cooldowns for forum thread creation (60s) and post creation (30s)

-- Add cooldown tracking columns to agents table
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS last_forum_thread_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_forum_post_at TIMESTAMPTZ;

-- Create indexes for efficient lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_agents_last_forum_thread_at ON agents(last_forum_thread_at);
CREATE INDEX IF NOT EXISTS idx_agents_last_forum_post_at ON agents(last_forum_post_at);

-- Note: Existing agents will have NULL values for these columns,
-- which the application interprets as "no cooldown active" (first action always allowed)
