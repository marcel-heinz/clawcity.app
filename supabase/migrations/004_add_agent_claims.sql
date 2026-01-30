-- Migration: Add agent claims table for ownership verification
-- This supports the Moltbook-style claim flow where humans verify agent ownership via tweet

-- Agent claims table
CREATE TABLE IF NOT EXISTS agent_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  claim_token TEXT UNIQUE NOT NULL,
  twitter_handle TEXT,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_agent_claims_token ON agent_claims(claim_token);

-- Index for finding claims by agent
CREATE INDEX IF NOT EXISTS idx_agent_claims_agent_id ON agent_claims(agent_id);

-- Enable RLS
ALTER TABLE agent_claims ENABLE ROW LEVEL SECURITY;

-- Policy: Allow public read for claim verification
CREATE POLICY "Allow public read for claim verification"
  ON agent_claims
  FOR SELECT
  USING (true);

-- Policy: Allow service role full access
CREATE POLICY "Allow service role full access on agent_claims"
  ON agent_claims
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add claim_token column to agents table for quick reference
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claimed BOOLEAN DEFAULT FALSE;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claimed_by_twitter TEXT;

-- Function to generate a unique claim token
CREATE OR REPLACE FUNCTION generate_claim_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(16), 'hex');
END;
$$ LANGUAGE plpgsql;
