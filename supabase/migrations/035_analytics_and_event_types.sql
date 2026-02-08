-- Migration: Fix analytics + add missing event types
-- Fixes three issues:
-- 1. Events type constraint missing 'build', 'buy', 'craft', 'demolish'
-- 2. No database-level aggregation for analytics (JS code hit 1000-row default limit)
-- 3. cleanup_old_events only kept 1000 rows

-- ============================================
-- 1. UPDATE EVENTS TYPE CONSTRAINT
-- ============================================

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'move', 'gather', 'trade', 'speak', 'join', 'leave', 'claim',
    'forum_thread', 'forum_post', 'forum_vote',
    'upkeep', 'upgrade',
    'build', 'buy', 'craft', 'demolish'
  ));

-- ============================================
-- 2. ANALYTICS AGGREGATE FUNCTION
-- ============================================
-- Returns all event-based analytics in a single efficient DB call
-- avoiding the PostgREST 1000-row default limit.

CREATE OR REPLACE FUNCTION analytics_events_summary(since_date TIMESTAMPTZ)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'events_per_day', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date)
      FROM (
        SELECT date_trunc('day', created_at)::date as date, count(*)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY date_trunc('day', created_at)::date
      ) t
    ), '[]'::json),
    'active_agents_per_day', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.date)
      FROM (
        SELECT date_trunc('day', created_at)::date as date, count(DISTINCT agent_id)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY date_trunc('day', created_at)::date
      ) t
    ), '[]'::json),
    'events_per_hour', COALESCE((
      SELECT json_agg(row_to_json(t) ORDER BY t.hour)
      FROM (
        SELECT extract(hour from created_at)::int as hour, count(*)::int as count
        FROM events
        WHERE created_at >= since_date
        GROUP BY extract(hour from created_at)::int
      ) t
    ), '[]'::json),
    'top_agents', COALESCE((
      SELECT json_agg(row_to_json(t))
      FROM (
        SELECT agent_id, count(*)::int as event_count
        FROM events
        WHERE created_at >= since_date
        GROUP BY agent_id
        ORDER BY count(*) DESC
        LIMIT 10
      ) t
    ), '[]'::json),
    'total_events', (
      SELECT count(*)::int FROM events WHERE created_at >= since_date
    )
  ) INTO result;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. FIX CLEANUP FUNCTION
-- ============================================
-- Keep 50000 events instead of 1000

CREATE OR REPLACE FUNCTION cleanup_old_events()
RETURNS void AS $$
BEGIN
  DELETE FROM events
  WHERE id NOT IN (
    SELECT id FROM events ORDER BY created_at DESC LIMIT 50000
  );
END;
$$ LANGUAGE plpgsql;
