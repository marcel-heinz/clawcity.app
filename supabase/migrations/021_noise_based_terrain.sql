-- Migration 021: Noise-Based Terrain Generation
-- This migration adds new terrain types for more realistic world generation
-- 
-- NEW TERRAIN TYPES:
-- - rocky: Barren rocky ground with no resources (transition terrain)
-- - sand: Beach/desert terrain with no resources (coastal areas)
-- - deep_water: Impassable deep water (natural barriers)
-- - marsh: Swampy wetland with minimal food resources
--
-- These non-resource terrains encourage agent movement by creating
-- geographic specialization and natural barriers.

-- ============================================
-- STEP 1: Update terrain constraint
-- ============================================

-- Drop the existing constraint
ALTER TABLE tiles DROP CONSTRAINT IF EXISTS tiles_terrain_check;

-- Add new constraint with all terrain types (including new ones)
ALTER TABLE tiles ADD CONSTRAINT tiles_terrain_check 
  CHECK (terrain IN (
    'plains', 
    'forest', 
    'mountain', 
    'market', 
    'water',
    -- New terrain types
    'rocky',      -- Barren rocky ground - no resources
    'sand',       -- Beach/desert - no resources
    'deep_water', -- Impassable deep water - no resources
    'marsh'       -- Swampy wetland - minimal food
  ));

-- ============================================
-- STEP 2: Update events constraint for new event types (if needed)
-- ============================================
-- Currently no new event types needed

-- ============================================
-- INSTRUCTIONS FOR REGENERATING WORLD TILES
-- ============================================
-- 
-- After applying this migration, you need to regenerate the world tiles
-- using the new noise-based algorithm. This can be done by:
--
-- 1. Using the admin API endpoint:
--    POST /api/world/tiles with Authorization: Bearer <ADMIN_KEY>
--
-- 2. Or by running the seed script manually
--
-- The new algorithm uses Simplex noise for:
-- - Elevation (determines mountains vs lowlands)
-- - Moisture (determines wet vs dry biomes)
-- 
-- Biome Matrix:
-- | Elevation / Moisture | Dry (0-0.3) | Medium (0.3-0.6) | Wet (0.6-1.0) |
-- |---------------------|-------------|------------------|---------------|
-- | High (0.7-1.0)      | Rocky       | Mountain         | Mountain      |
-- | Medium-High (0.5-0.7)| Rocky      | Plains           | Forest        |
-- | Medium (0.3-0.5)    | Plains      | Plains           | Forest        |
-- | Low (0.15-0.3)      | Sand        | Plains           | Marsh         |
-- | Very Low (0-0.15)   | Water       | Water            | Deep Water    |
--

-- ============================================
-- COMMENT: This migration is backwards compatible
-- ============================================
-- Existing terrain types continue to work. The new types
-- only appear when world tiles are regenerated with the
-- new noise-based algorithm.
