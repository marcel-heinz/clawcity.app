-- Remove plaintext claim tokens (only hashes should be stored)
-- This matches the pattern already used for API keys

-- Drop the unique constraint and index on plaintext claim_token
-- (constraint name follows Postgres convention: {table}_{column}_key)
ALTER TABLE agent_claims DROP CONSTRAINT IF EXISTS agent_claims_claim_token_key;
DROP INDEX IF EXISTS idx_agent_claims_token;

-- Now safe to clear all plaintext values
UPDATE agents SET claim_token = '' WHERE claim_token != '' AND claim_token IS NOT NULL;
UPDATE agent_claims SET claim_token = '' WHERE claim_token != '' AND claim_token IS NOT NULL;
