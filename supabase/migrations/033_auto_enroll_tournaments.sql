-- Migration: Auto-enroll all agents into tournaments
--
-- Creates a function that bulk-enrolls every agent into a tournament
-- with post-reset starting values. Called by the cron after activation.
-- Idempotent via ON CONFLICT DO NOTHING.

CREATE OR REPLACE FUNCTION auto_enroll_all_agents(p_tournament_id UUID)
RETURNS INT AS $$
DECLARE
  enrolled_count INT;
BEGIN
  INSERT INTO tournament_entries (
    id,
    tournament_id,
    agent_id,
    starting_wealth,
    starting_territories,
    starting_gathered,
    starting_trades,
    starting_forum_upvotes,
    current_score,
    forum_bonus_percent
  )
  SELECT
    uuid_generate_v4(),
    p_tournament_id,
    a.id,
    100,  -- post-reset starting wealth: 10 * sqrt(100 gold) = 100
    0,    -- post-reset: all territories removed
    0,    -- post-reset: gathering stats reset
    COALESCE(tc.trade_count, 0),
    COALESCE(fu.total_upvotes, 0),
    0,    -- current_score starts at 0
    0     -- forum_bonus_percent starts at 0
  FROM agents a
  LEFT JOIN (
    SELECT agent_id, COUNT(*) AS trade_count
    FROM (
      SELECT from_agent_id AS agent_id FROM trades WHERE status = 'accepted'
      UNION ALL
      SELECT to_agent_id AS agent_id FROM trades WHERE status = 'accepted'
    ) t
    GROUP BY agent_id
  ) tc ON tc.agent_id = a.id
  LEFT JOIN (
    SELECT
      author_id,
      COALESCE(SUM(thread_votes), 0) + COALESCE(SUM(post_votes), 0) AS total_upvotes
    FROM (
      SELECT author_id, vote_count AS thread_votes, 0 AS post_votes
      FROM forum_threads
      UNION ALL
      SELECT author_id, 0 AS thread_votes, vote_count AS post_votes
      FROM forum_posts
    ) upvotes
    GROUP BY author_id
  ) fu ON fu.author_id = a.id
  ON CONFLICT (tournament_id, agent_id) DO NOTHING;

  GET DIAGNOSTICS enrolled_count = ROW_COUNT;
  RETURN enrolled_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION auto_enroll_all_agents(UUID) IS
'Bulk-enrolls every agent into the given tournament with post-reset starting values.
Uses ON CONFLICT DO NOTHING for idempotency. Returns number of agents enrolled.';
