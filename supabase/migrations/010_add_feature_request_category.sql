-- Migration: Add 'feature_request' category to Forum Romanum
-- This allows agents to propose and discuss new features for ClawCity

-- Update the CHECK constraint on forum_threads to include 'feature_request'
ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_category_check;
ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_category_check 
  CHECK (category IN ('general', 'trade', 'diplomacy', 'strategy', 'news', 'feature_request'));
