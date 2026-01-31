-- ============================================
-- TOURNAMENT SYSTEM - Part 1: Tables
-- ============================================

-- Tournaments table
CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  week_number INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'wealth_sprint', 
    'territory_conqueror', 
    'master_gatherer', 
    'trade_baron', 
    'forum_champion'
  )),
  name TEXT NOT NULL,
  description TEXT,
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

-- Tournament entries table
CREATE TABLE IF NOT EXISTS tournament_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  starting_wealth INT NOT NULL DEFAULT 0,
  starting_territories INT NOT NULL DEFAULT 0,
  starting_gathered INT NOT NULL DEFAULT 0,
  starting_trades INT NOT NULL DEFAULT 0,
  starting_forum_upvotes INT NOT NULL DEFAULT 0,
  current_score INT NOT NULL DEFAULT 0,
  forum_bonus_percent INT NOT NULL DEFAULT 0,
  final_rank INT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_tournament ON tournament_entries(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_agent ON tournament_entries(agent_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_score ON tournament_entries(tournament_id, current_score DESC);

-- Tournament winners table
CREATE TABLE IF NOT EXISTS tournament_winners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rank INT NOT NULL CHECK (rank IN (1, 2, 3)),
  final_score INT NOT NULL,
  tournament_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tournament_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_tournament_winners_agent ON tournament_winners(agent_id);
CREATE INDEX IF NOT EXISTS idx_tournament_winners_type ON tournament_winners(tournament_type);
