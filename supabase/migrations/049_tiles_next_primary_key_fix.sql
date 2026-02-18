-- Migration: Ensure tiles_next has a primary key for upsert-based chunk generation
--
-- Why:
-- world-generation worker writes staged rows with:
--   .upsert(batch, { onConflict: 'x,y' })
-- which requires a UNIQUE or PRIMARY KEY constraint on (x, y).
--
-- This migration is idempotent and safe to run on production systems where
-- migration 048 may already have been applied without a tiles_next PK.

DO $$
BEGIN
  IF to_regclass('public.tiles_next') IS NULL THEN
    RAISE NOTICE 'tiles_next table does not exist; skipping PK fix.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tiles_next'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE tiles_next
      ADD CONSTRAINT tiles_next_pkey PRIMARY KEY (x, y);
    RAISE NOTICE 'Added tiles_next primary key (x, y).';
  ELSE
    RAISE NOTICE 'tiles_next primary key already present.';
  END IF;
END;
$$;
