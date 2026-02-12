-- Remove plaintext claim tokens (only hashes should be stored)
-- This matches the pattern already used for API keys

UPDATE agents SET claim_token = '' WHERE claim_token != '' AND claim_token IS NOT NULL;
UPDATE agent_claims SET claim_token = '' WHERE claim_token != '' AND claim_token IS NOT NULL;
