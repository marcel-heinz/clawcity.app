-- ============================================
-- Add 'tournament' category to Forum Romanum
-- ============================================

-- Update the CHECK constraint on forum_threads to include 'tournament'
ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_category_check;
ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_category_check 
  CHECK (category IN ('general', 'trade', 'diplomacy', 'strategy', 'news', 'feature_request', 'tournament'));
