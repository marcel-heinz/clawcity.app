-- Migration: Security Hardening
-- Tighten RLS policies, add safe public views, protect sensitive data

-- ============================================
-- 1. DROP EXISTING OVERLY-PERMISSIVE POLICIES
-- ============================================

-- Drop old policies that expose sensitive data
DROP POLICY IF EXISTS "Allow anonymous read access to agents" ON agents;
DROP POLICY IF EXISTS "Allow anonymous read access to events" ON events;
DROP POLICY IF EXISTS "Allow public read for claim verification" ON agent_claims;
DROP POLICY IF EXISTS "Allow service role full access on agent_claims" ON agent_claims;

-- ============================================
-- 2. CREATE SAFE PUBLIC VIEW FOR AGENTS
-- ============================================

-- This view exposes only non-sensitive agent data for public consumption
CREATE OR REPLACE VIEW agents_public AS
SELECT 
  id,
  name,
  x,
  y,
  gold,
  wood,
  food,
  stone,
  reputation,
  created_at,
  last_active,
  claimed,
  claimed_by_twitter,
  (gold + (wood * 2) + (stone * 3) + food) as wealth
FROM agents;

-- Grant SELECT on the public view to anon and authenticated roles
GRANT SELECT ON agents_public TO anon;
GRANT SELECT ON agents_public TO authenticated;

-- ============================================
-- 3. CREATE SAFE PUBLIC VIEW FOR EVENTS
-- ============================================

-- This view hides whisper content from non-participants
-- Public events show everything, whispers show redacted content
CREATE OR REPLACE VIEW events_public AS
SELECT 
  id,
  agent_id,
  type,
  CASE 
    WHEN type = 'speak' AND (data->>'is_whisper')::boolean = true 
    THEN jsonb_build_object(
      'message', '[whisper]',
      'is_whisper', true,
      'target_id', data->>'target_id',
      'target_name', data->>'target_name'
    )
    ELSE data
  END as data,
  location,
  created_at
FROM events;

-- Grant SELECT on the public events view
GRANT SELECT ON events_public TO anon;
GRANT SELECT ON events_public TO authenticated;

-- ============================================
-- 4. RESTRICTIVE POLICIES FOR AGENTS TABLE
-- ============================================

-- No anonymous direct read access to agents table (use view instead)
-- Service role bypasses RLS, so API routes using service key still work

-- Policy: Only service role can read full agent data (includes api_key)
CREATE POLICY "Service role full access to agents"
  ON agents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 5. RESTRICTIVE POLICIES FOR EVENTS TABLE
-- ============================================

-- Policy: Only service role can read full events (use view for public)
CREATE POLICY "Service role full access to events"
  ON events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 6. RESTRICTIVE POLICIES FOR AGENT_CLAIMS
-- ============================================

-- Policy: Only service role can access agent_claims
-- This protects claim tokens from being enumerated
CREATE POLICY "Service role full access to agent_claims"
  ON agent_claims
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- 7. KEEP EXISTING SAFE POLICIES
-- ============================================

-- Tiles remain publicly readable (no sensitive data)
-- Trades remain publicly readable (trade info is public game state)
-- Game settings remain publicly readable (limits are public info)
-- Feature requests: insert-only for anon, read for service role (already correct)

-- ============================================
-- 8. ADD COLUMN FOR HASHED API KEY
-- ============================================

-- Add column to store hashed API key (plain key will be removed later)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS api_key_hash TEXT;

-- Add column to store hashed claim token
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_token_hash TEXT;
ALTER TABLE agent_claims ADD COLUMN IF NOT EXISTS claim_token_hash TEXT;

-- Create index on hashed api key for fast lookups
CREATE INDEX IF NOT EXISTS idx_agents_api_key_hash ON agents(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_agent_claims_token_hash ON agent_claims(claim_token_hash);

-- ============================================
-- 9. CREATE ADMIN AUDIT LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for recent audit entries
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);

-- Enable RLS
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only service role can access audit log
CREATE POLICY "Service role full access to admin_audit_log"
  ON admin_audit_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Done!
