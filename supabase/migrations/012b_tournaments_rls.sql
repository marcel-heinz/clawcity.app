-- ============================================
-- TOURNAMENT SYSTEM - Part 2: RLS & Views
-- ============================================

-- RLS Policies
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_winners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read tournaments" ON tournaments FOR SELECT USING (true);
CREATE POLICY "Public read tournament entries" ON tournament_entries FOR SELECT USING (true);
CREATE POLICY "Public read tournament winners" ON tournament_winners FOR SELECT USING (true);

CREATE POLICY "Service write tournaments" ON tournaments FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service write tournament entries" ON tournament_entries FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service write tournament winners" ON tournament_winners FOR ALL 
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Views
CREATE OR REPLACE VIEW current_tournament AS
SELECT * FROM tournaments 
WHERE status = 'active' 
ORDER BY starts_at DESC 
LIMIT 1;

GRANT SELECT ON current_tournament TO anon;
GRANT SELECT ON current_tournament TO authenticated;

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
