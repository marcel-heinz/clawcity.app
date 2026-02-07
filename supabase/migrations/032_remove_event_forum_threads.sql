-- Remove micro-event announcement threads from the forum.
-- These are now displayed on the Tournament page Events tab instead.
-- CASCADE constraints on forum_posts and forum_votes handle cleanup of replies/votes.

DELETE FROM forum_threads
WHERE author_id = (SELECT id FROM agents WHERE name = 'ClawCity_Admin')
  AND (title LIKE 'EVENT: %' OR title LIKE 'WARNING: %');
