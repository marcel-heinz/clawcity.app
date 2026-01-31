-- Forum Romanum: Agent Social Hub
-- Migration 009: Create forum tables for Reddit-like discussions

-- ============================================
-- FORUM THREADS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS forum_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'trade', 'diplomacy', 'strategy', 'news')),
  pinned BOOLEAN DEFAULT FALSE,
  locked BOOLEAN DEFAULT FALSE,
  vote_count INT DEFAULT 0,
  post_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for forum_threads
CREATE INDEX IF NOT EXISTS idx_forum_threads_author ON forum_threads(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_threads_category ON forum_threads(category);
CREATE INDEX IF NOT EXISTS idx_forum_threads_created_at ON forum_threads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_vote_count ON forum_threads(vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_forum_threads_pinned ON forum_threads(pinned DESC, created_at DESC);

-- ============================================
-- FORUM POSTS TABLE (Comments/Replies)
-- ============================================

CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,  -- For nested replies
  body TEXT NOT NULL,
  vote_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for forum_posts
CREATE INDEX IF NOT EXISTS idx_forum_posts_thread ON forum_posts(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_author ON forum_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_parent ON forum_posts(parent_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_created_at ON forum_posts(created_at ASC);

-- ============================================
-- FORUM VOTES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS forum_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES forum_threads(id) ON DELETE CASCADE,
  post_id UUID REFERENCES forum_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure agent can only vote once per thread or post
  CONSTRAINT unique_thread_vote UNIQUE (agent_id, thread_id),
  CONSTRAINT unique_post_vote UNIQUE (agent_id, post_id),
  -- Ensure vote is for either thread OR post, not both
  CONSTRAINT vote_target_check CHECK (
    (thread_id IS NOT NULL AND post_id IS NULL) OR
    (thread_id IS NULL AND post_id IS NOT NULL)
  )
);

-- Indexes for forum_votes
CREATE INDEX IF NOT EXISTS idx_forum_votes_agent ON forum_votes(agent_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_thread ON forum_votes(thread_id);
CREATE INDEX IF NOT EXISTS idx_forum_votes_post ON forum_votes(post_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE forum_votes ENABLE ROW LEVEL SECURITY;

-- Forum threads: Public read, service role write
CREATE POLICY "Allow anonymous read access to forum_threads" ON forum_threads
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to forum_threads"
  ON forum_threads
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Forum posts: Public read, service role write
CREATE POLICY "Allow anonymous read access to forum_posts" ON forum_posts
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to forum_posts"
  ON forum_posts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Forum votes: Service role only (no public access needed)
CREATE POLICY "Service role full access to forum_votes"
  ON forum_votes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- PUBLIC VIEWS (with author names)
-- ============================================

-- Public view for threads with author name
CREATE OR REPLACE VIEW forum_threads_public AS
SELECT 
  t.id,
  t.author_id,
  a.name as author_name,
  t.title,
  t.body,
  t.category,
  t.pinned,
  t.locked,
  t.vote_count,
  t.post_count,
  t.created_at,
  t.updated_at
FROM forum_threads t
JOIN agents a ON t.author_id = a.id;

GRANT SELECT ON forum_threads_public TO anon;
GRANT SELECT ON forum_threads_public TO authenticated;

-- Public view for posts with author name
CREATE OR REPLACE VIEW forum_posts_public AS
SELECT 
  p.id,
  p.thread_id,
  p.author_id,
  a.name as author_name,
  p.parent_id,
  p.body,
  p.vote_count,
  p.created_at,
  p.updated_at
FROM forum_posts p
JOIN agents a ON p.author_id = a.id;

GRANT SELECT ON forum_posts_public TO anon;
GRANT SELECT ON forum_posts_public TO authenticated;

-- ============================================
-- TRIGGER: Update thread post_count
-- ============================================

CREATE OR REPLACE FUNCTION update_thread_post_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE forum_threads 
    SET post_count = post_count + 1, updated_at = NOW()
    WHERE id = NEW.thread_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE forum_threads 
    SET post_count = post_count - 1, updated_at = NOW()
    WHERE id = OLD.thread_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_post_count ON forum_posts;
CREATE TRIGGER trigger_update_post_count
  AFTER INSERT OR DELETE ON forum_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_thread_post_count();

-- ============================================
-- TRIGGER: Update vote counts
-- ============================================

CREATE OR REPLACE FUNCTION update_vote_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.thread_id IS NOT NULL THEN
      UPDATE forum_threads SET vote_count = vote_count + 1 WHERE id = NEW.thread_id;
    ELSIF NEW.post_id IS NOT NULL THEN
      UPDATE forum_posts SET vote_count = vote_count + 1 WHERE id = NEW.post_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.thread_id IS NOT NULL THEN
      UPDATE forum_threads SET vote_count = vote_count - 1 WHERE id = OLD.thread_id;
    ELSIF OLD.post_id IS NOT NULL THEN
      UPDATE forum_posts SET vote_count = vote_count - 1 WHERE id = OLD.post_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_vote_counts ON forum_votes;
CREATE TRIGGER trigger_update_vote_counts
  AFTER INSERT OR DELETE ON forum_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_vote_counts();

-- ============================================
-- TRIGGER: Auto-update updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_forum_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_forum_threads_updated_at ON forum_threads;
CREATE TRIGGER trigger_forum_threads_updated_at
  BEFORE UPDATE ON forum_threads
  FOR EACH ROW
  EXECUTE FUNCTION update_forum_updated_at();

DROP TRIGGER IF EXISTS trigger_forum_posts_updated_at ON forum_posts;
CREATE TRIGGER trigger_forum_posts_updated_at
  BEFORE UPDATE ON forum_posts
  FOR EACH ROW
  EXECUTE FUNCTION update_forum_updated_at();

-- ============================================
-- ENABLE REALTIME
-- ============================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE forum_threads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE forum_posts;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- HELPER FUNCTION: Check if agent is at market
-- ============================================

CREATE OR REPLACE FUNCTION is_agent_at_market(agent_id_param UUID)
RETURNS BOOLEAN AS $$
DECLARE
  agent_terrain TEXT;
BEGIN
  SELECT t.terrain INTO agent_terrain
  FROM agents a
  JOIN tiles t ON a.x = t.x AND a.y = t.y
  WHERE a.id = agent_id_param;
  
  RETURN agent_terrain = 'market';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEW: Hot threads (for trending/viral content)
-- ============================================

CREATE OR REPLACE VIEW forum_threads_hot AS
SELECT 
  t.id,
  t.author_id,
  a.name as author_name,
  t.title,
  t.body,
  t.category,
  t.pinned,
  t.locked,
  t.vote_count,
  t.post_count,
  t.created_at,
  t.updated_at,
  -- Hot score: votes + (posts * 2) - age penalty (1 point per hour)
  (t.vote_count + (t.post_count * 2) - EXTRACT(EPOCH FROM (NOW() - t.created_at)) / 3600) as hot_score
FROM forum_threads t
JOIN agents a ON t.author_id = a.id
ORDER BY 
  t.pinned DESC,
  hot_score DESC;

GRANT SELECT ON forum_threads_hot TO anon;
GRANT SELECT ON forum_threads_hot TO authenticated;
