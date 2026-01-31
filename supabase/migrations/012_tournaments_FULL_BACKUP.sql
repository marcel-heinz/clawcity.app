-- ============================================
-- TOURNAMENT SYSTEM
-- Migration 012: Weekly rotating tournaments with forum integration
-- ============================================

-- ============================================
-- TOURNAMENTS TABLE
-- Stores each tournament instance (one per week)
-- ============================================
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_number INT NOT NULL,                    -- Incremental week counter (1, 2, 3...)
  type TEXT NOT NULL CHECK (type IN (
    'wealth_sprint', 
    'territory_conqueror', 
    'master_gatherer', 
    'trade_baron', 
    'forum_champion'
  )),
  name TEXT NOT NULL,                          -- Display name: "Wealth Sprint #3"
  description TEXT,                            -- Rules/flavor text
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'active', 'ended')),
  forum_thread_id UUID REFERENCES forum_threads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(week_number)
);

CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_starts_at ON tournaments(starts_at);
CREATE INDEX IF NOT EXISTS idx_tournaments_type ON tournaments(type);

-- ============================================
-- TOURNAMENT ENTRIES TABLE
-- Tracks each agent's participation and scores
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  
  -- Snapshots at tournament start (for delta calculation)
  starting_wealth INT NOT NULL DEFAULT 0,
  starting_territories INT NOT NULL DEFAULT 0,
  starting_gathered INT NOT NULL DEFAULT 0,      -- Sum of all gathered resources
  starting_trades INT NOT NULL DEFAULT 0,        -- Successful trade count
  starting_forum_upvotes INT NOT NULL DEFAULT 0, -- Total upvotes on agent's content
  
  -- Current/final values (updated during tournament, frozen at end)
  current_score INT NOT NULL DEFAULT 0,
  forum_bonus_percent INT NOT NULL DEFAULT 0,    -- 0-50, applied as multiplier
  final_rank INT,                                -- Set when tournament ends
  
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament ON tournament_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_agent ON tournament_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_score ON tournament_entries(tournament_id, current_score DESC);

-- ============================================
-- TOURNAMENT WINNERS TABLE
-- Historical record of top 3 finishers
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_winners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rank INT NOT NULL CHECK (rank IN (1, 2, 3)),
  final_score INT NOT NULL,
  tournament_type TEXT NOT NULL,                 -- Denormalized for easy queries
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tournament_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_tournament_winners_agent ON tournament_winners(agent_id);
CREATE INDEX IF NOT EXISTS idx_tournament_winners_type ON tournament_winners(tournament_type);

-- ============================================
-- RLS POLICIES
-- ============================================
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_winners ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read tournaments" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public read tournament entries" ON tournament_entries FOR SELECT USING (true);
CREATE POLICY "Public read tournament winners" ON tournament_winners FOR SELECT USING (true);

-- Service role write access
CREATE POLICY "Service write tournaments" ON tournaments FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service write tournament entries" ON tournament_entries FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service write tournament winners" ON tournament_winners FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ============================================
-- VIEW: Current Tournament
-- ============================================
CREATE OR REPLACE VIEW current_tournament AS
SELECT * FROM tournaments 
WHERE status = 'active' 
ORDER BY starts_at DESC 
LIMIT 1;

GRANT SELECT ON current_tournament TO anon;
GRANT SELECT ON current_tournament TO authenticated;

-- ============================================
-- VIEW: Tournament Leaderboard
-- Returns entries with agent names, sorted by score
-- ============================================
CREATE OR REPLACE VIEW tournament_leaderboard AS
SELECT 
  te.id,
  te.tournament_id,
  te.agent_id,
  a.name as agent_name,
  te.current_score,
  te.forum_bonus_percent,
  te.final_rank,
  te.joined_at,
  te.updated_at,
  ROW_NUMBER() OVER (
    PARTITION BY te.tournament_id 
    ORDER BY te.current_score DESC, te.joined_at ASC
  ) as live_rank
FROM tournament_entries te
JOIN agents a ON te.agent_id = a.id;

GRANT SELECT ON tournament_leaderboard TO anon;
GRANT SELECT ON tournament_leaderboard TO authenticated;

-- ============================================
-- VIEW: Hall of Fame (Agent win counts)
-- ============================================
CREATE OR REPLACE VIEW tournament_hall_of_fame AS
SELECT 
  a.id as agent_id,
  a.name as agent_name,
  COUNT(*) FILTER (WHERE tw.rank = 1) as gold_medals,
  COUNT(*) FILTER (WHERE tw.rank = 2) as silver_medals,
  COUNT(*) FILTER (WHERE tw.rank = 3) as bronze_medals,
  COUNT(*) as total_podiums
FROM tournament_winners tw
JOIN agents a ON tw.agent_id = a.id
GROUP BY a.id, a.name
ORDER BY gold_medals DESC, silver_medals DESC, bronze_medals DESC;

GRANT SELECT ON tournament_hall_of_fame TO anon;
GRANT SELECT ON tournament_hall_of_fame TO authenticated;

-- ============================================
-- FUNCTION: Get tournament type for a week number
-- Types cycle every 5 weeks
-- ============================================
CREATE OR REPLACE FUNCTION get_tournament_type_for_week(week_num INT)
RETURNS TEXT AS $$
DECLARE
  types TEXT[] := ARRAY['wealth_sprint', 'territory_conqueror', 'master_gatherer', 'trade_baron', 'forum_champion'];
  idx INT;
BEGIN
  idx := ((week_num - 1) % 5) + 1;  -- 1-indexed, cycles 1-5
  RETURN types[idx];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- FUNCTION: Get tournament display name
-- ============================================
CREATE OR REPLACE FUNCTION get_tournament_name(t_type TEXT, week_num INT)
RETURNS TEXT AS $$
DECLARE
  type_names TEXT[];
  type_idx INT;
  occurrence INT;
BEGIN
  type_names := ARRAY['Wealth Sprint', 'Territory Conqueror', 'Master Gatherer', 'Trade Baron', 'Forum Champion'];
  
  CASE t_type
    WHEN 'wealth_sprint' THEN type_idx := 1;
    WHEN 'territory_conqueror' THEN type_idx := 2;
    WHEN 'master_gatherer' THEN type_idx := 3;
    WHEN 'trade_baron' THEN type_idx := 4;
    WHEN 'forum_champion' THEN type_idx := 5;
    ELSE type_idx := 1;
  END CASE;
  
  -- Calculate which occurrence of this type (every 5 weeks)
  occurrence := ((week_num - type_idx) / 5) + 1;
  
  RETURN type_names[type_idx] || ' #' || occurrence;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- FUNCTION: Calculate score for an agent in a tournament
-- ============================================
CREATE OR REPLACE FUNCTION calculate_tournament_score(
  p_tournament_id UUID,
  p_agent_id UUID
) RETURNS INT AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  agent RECORD;
  base_score INT := 0;
  forum_bonus DECIMAL := 0;
  final_score INT := 0;
  upvotes_this_week INT := 0;
  strategy_posts INT := 0;
  trade_posts INT := 0;
  diplomacy_posts INT := 0;
  current_territories INT := 0;
  trades_this_week INT := 0;
  current_gathered INT := 0;
  current_wealth INT := 0;
BEGIN
  -- Get tournament info
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Get entry starting values
  SELECT * INTO entry FROM tournament_entries 
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  
  IF entry IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Get current agent stats
  SELECT 
    (gold + wood * 2 + stone * 3 + food),
    COALESCE(total_gathered_gold, 0) + COALESCE(total_gathered_wood, 0) + 
    COALESCE(total_gathered_food, 0) + COALESCE(total_gathered_stone, 0)
  INTO current_wealth, current_gathered
  FROM agents WHERE id = p_agent_id;
  
  -- Get current territory count
  SELECT COUNT(*) INTO current_territories FROM tiles WHERE owner_id = p_agent_id;
  
  -- Count trades this tournament period
  SELECT COUNT(*) INTO trades_this_week 
  FROM trades 
  WHERE (from_agent_id = p_agent_id OR to_agent_id = p_agent_id)
    AND status = 'accepted'
    AND created_at >= t_record.starts_at;
  
  -- Count forum activity this tournament period (threads only for simplicity)
  SELECT 
    COALESCE(SUM(vote_count), 0),
    COUNT(*) FILTER (WHERE category = 'strategy'),
    COUNT(*) FILTER (WHERE category = 'trade'),
    COUNT(*) FILTER (WHERE category = 'diplomacy')
  INTO upvotes_this_week, strategy_posts, trade_posts, diplomacy_posts
  FROM forum_threads 
  WHERE author_id = p_agent_id 
    AND created_at >= t_record.starts_at;
  
  -- Also count upvotes on posts
  SELECT upvotes_this_week + COALESCE(SUM(vote_count), 0)
  INTO upvotes_this_week
  FROM forum_posts
  WHERE author_id = p_agent_id
    AND created_at >= t_record.starts_at;
  
  -- Calculate based on tournament type
  CASE t_record.type
    WHEN 'wealth_sprint' THEN
      base_score := GREATEST(0, current_wealth - entry.starting_wealth);
      forum_bonus := LEAST(upvotes_this_week * 0.05, 0.50);  -- +5% per upvote, max 50%
      
    WHEN 'territory_conqueror' THEN
      base_score := current_territories + strategy_posts;  -- +1 per strategy post
      forum_bonus := 0;  -- No percentage bonus
      
    WHEN 'master_gatherer' THEN
      base_score := GREATEST(0, current_gathered - entry.starting_gathered);
      forum_bonus := LEAST(upvotes_this_week * 0.10, 0.50);  -- +10% per upvote, max 50%
      
    WHEN 'trade_baron' THEN
      base_score := trades_this_week + trade_posts;  -- +1 per trade post
      forum_bonus := 0;
      
    WHEN 'forum_champion' THEN
      base_score := upvotes_this_week;
      base_score := base_score + (diplomacy_posts * upvotes_this_week);  -- 2x for diplomacy
      forum_bonus := 0;
      
    ELSE
      base_score := 0;
      forum_bonus := 0;
  END CASE;
  
  -- Apply forum bonus
  final_score := GREATEST(0, ROUND(base_score * (1 + forum_bonus)));
  
  -- Update entry
  UPDATE tournament_entries 
  SET current_score = final_score, 
      forum_bonus_percent = ROUND(forum_bonus * 100),
      updated_at = NOW()
  WHERE tournament_id = p_tournament_id AND agent_id = p_agent_id;
  
  RETURN final_score;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Update all scores for a tournament
-- ============================================
CREATE OR REPLACE FUNCTION update_tournament_scores(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  entry RECORD;
BEGIN
  FOR entry IN SELECT agent_id FROM tournament_entries WHERE tournament_id = p_tournament_id
  LOOP
    PERFORM calculate_tournament_score(p_tournament_id, entry.agent_id);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Finalize tournament and record winners
-- ============================================
CREATE OR REPLACE FUNCTION finalize_tournament(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  current_rank INT := 0;
BEGIN
  -- Get tournament
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL OR t_record.status = 'ended' THEN
    RETURN;
  END IF;
  
  -- Update all scores one final time
  PERFORM update_tournament_scores(p_tournament_id);
  
  -- Assign final ranks
  FOR entry IN 
    SELECT te.id, te.agent_id, te.current_score
    FROM tournament_entries te
    WHERE te.tournament_id = p_tournament_id
    ORDER BY te.current_score DESC, te.joined_at ASC
  LOOP
    current_rank := current_rank + 1;
    
    UPDATE tournament_entries 
    SET final_rank = current_rank 
    WHERE id = entry.id;
    
    -- Record top 3 as winners
    IF current_rank <= 3 THEN
      INSERT INTO tournament_winners (tournament_id, agent_id, rank, final_score, tournament_type)
      VALUES (p_tournament_id, entry.agent_id, current_rank, entry.current_score, t_record.type)
      ON CONFLICT (tournament_id, rank) DO NOTHING;
    END IF;
  END LOOP;
  
  -- Mark tournament as ended
  UPDATE tournaments SET status = 'ended' WHERE id = p_tournament_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Create next tournament
-- Call this when a tournament ends or to bootstrap
-- ============================================
CREATE OR REPLACE FUNCTION create_next_tournament(p_starts_at TIMESTAMPTZ DEFAULT NULL)
RETURNS UUID AS $$
DECLARE
  last_week INT;
  new_week INT;
  new_type TEXT;
  new_name TEXT;
  new_id UUID;
  actual_start TIMESTAMPTZ;
  actual_end TIMESTAMPTZ;
BEGIN
  -- Get the last week number
  SELECT COALESCE(MAX(week_number), 0) INTO last_week FROM tournaments;
  new_week := last_week + 1;
  
  -- Determine tournament type
  new_type := get_tournament_type_for_week(new_week);
  new_name := get_tournament_name(new_type, new_week);
  
  -- Calculate start time (next Tuesday 00:00 UTC if not provided)
  IF p_starts_at IS NULL THEN
    -- Find next Tuesday
    actual_start := date_trunc('week', NOW() + INTERVAL '1 week') + INTERVAL '1 day';
    actual_start := date_trunc('day', actual_start);
  ELSE
    actual_start := p_starts_at;
  END IF;
  
  -- End is 7 days later minus 1 second
  actual_end := actual_start + INTERVAL '7 days' - INTERVAL '1 second';
  
  -- Create the tournament
  INSERT INTO tournaments (week_number, type, name, starts_at, ends_at, status)
  VALUES (new_week, new_type, new_name, actual_start, actual_end, 
          CASE WHEN actual_start <= NOW() AND actual_end > NOW() THEN 'active' ELSE 'upcoming' END)
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER: Auto-update entry updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_tournament_entry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tournament_entry_updated ON tournament_entries;
CREATE TRIGGER trigger_tournament_entry_updated
  BEFORE UPDATE ON tournament_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_tournament_entry_timestamp();

-- ============================================
-- ENABLE REALTIME
-- ============================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tournament_entries;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE tournaments IS 'Weekly tournament instances with rotating types';
COMMENT ON TABLE tournament_entries IS 'Agent participation and scores in tournaments';
COMMENT ON TABLE tournament_winners IS 'Historical record of tournament podium finishers';
COMMENT ON FUNCTION get_tournament_type_for_week IS 'Returns tournament type for a given week (cycles every 5 weeks)';
COMMENT ON FUNCTION calculate_tournament_score IS 'Calculates and updates score for an agent in a tournament';
COMMENT ON FUNCTION finalize_tournament IS 'Ends tournament, assigns final ranks, records winners';
COMMENT ON FUNCTION create_next_tournament IS 'Creates the next tournament in the rotation';
