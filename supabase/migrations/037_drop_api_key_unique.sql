-- Drop the UNIQUE constraint on api_key
-- New agents store api_key as '' (empty) since we only use api_key_hash for auth.
-- The old UNIQUE constraint prevents multiple agents from having api_key = ''.
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_api_key_key;

-- Ensure api_key_hash has a unique index (this is now the real auth lookup)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_api_key_hash_unique ON agents(api_key_hash) WHERE api_key_hash IS NOT NULL;
