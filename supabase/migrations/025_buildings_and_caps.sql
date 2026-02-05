-- =============================================================================
-- 025: Buildings System & Resource Caps
-- =============================================================================
-- Adds building support to tiles and tracks building upkeep state.
-- Buildings: storage (resource cap +500), workshop (advanced recipes), fortification (territory defense)
-- Resource caps: default 500 per resource, increased by storage buildings
-- =============================================================================

-- Add building columns to tiles
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS building_type TEXT DEFAULT NULL;
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS building_built_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE tiles ADD COLUMN IF NOT EXISTS building_upkeep_paid_at TIMESTAMPTZ DEFAULT NULL;

-- Add build cooldown to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_build_at TIMESTAMPTZ DEFAULT NULL;

-- Index for finding all buildings (for upkeep cron)
CREATE INDEX IF NOT EXISTS idx_tiles_building_type ON tiles (building_type) WHERE building_type IS NOT NULL;

-- Index for finding buildings by owner (for cap calculation)
CREATE INDEX IF NOT EXISTS idx_tiles_owner_building ON tiles (owner_id, building_type) WHERE owner_id IS NOT NULL AND building_type IS NOT NULL;

-- Validate building_type values
ALTER TABLE tiles ADD CONSTRAINT check_building_type
  CHECK (building_type IS NULL OR building_type IN ('storage', 'workshop', 'fortification'));

-- Ensure building requires ownership
ALTER TABLE tiles ADD CONSTRAINT check_building_requires_owner
  CHECK (building_type IS NULL OR owner_id IS NOT NULL);
