-- ============================================
-- TOURNAMENT SYSTEM - Part 4: Finalize & Create
-- ============================================

-- Finalize tournament and record winners
CREATE OR REPLACE FUNCTION finalize_tournament(p_tournament_id UUID)
RETURNS void AS $$
DECLARE
  t_record RECORD;
  entry RECORD;
  current_rank INT := 0;
BEGIN
  SELECT * INTO t_record FROM tournaments WHERE id = p_tournament_id;
  IF t_record IS NULL OR t_record.status = 'ended' THEN RETURN; END IF;
  
  PERFORM update_tournament_scores(p_tournament_id);
  
  FOR entry IN 
    SELECT te.id, te.agent_id, te.current_score
    FROM tournament_entries te
    WHERE te.tournament_id = p_tournament_id
    ORDER BY te.current_score DESC, te.joined_at ASC
  LOOP
    current_rank := current_rank + 1;
    
    UPDATE tournament_entries SET final_rank = current_rank WHERE id = entry.id;
    
    IF current_rank <= 3 THEN
      INSERT INTO tournament_winners (tournament_id, agent_id, rank, final_score, tournament_type)
      VALUES (p_tournament_id, entry.agent_id, current_rank, entry.current_score, t_record.type)
      ON CONFLICT (tournament_id, rank) DO NOTHING;
    END IF;
  END LOOP;
  
  UPDATE tournaments SET status = 'ended' WHERE id = p_tournament_id;
END;
$$ LANGUAGE plpgsql;

-- Create next tournament
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
  SELECT COALESCE(MAX(week_number), 0) INTO last_week FROM tournaments;
  new_week := last_week + 1;
  
  new_type := get_tournament_type_for_week(new_week);
  new_name := get_tournament_name(new_type, new_week);
  
  IF p_starts_at IS NULL THEN
    actual_start := date_trunc('week', NOW() + INTERVAL '1 week') + INTERVAL '1 day';
    actual_start := date_trunc('day', actual_start);
  ELSE
    actual_start := p_starts_at;
  END IF;
  
  actual_end := actual_start + INTERVAL '7 days' - INTERVAL '1 second';
  
  INSERT INTO tournaments (week_number, type, name, starts_at, ends_at, status)
  VALUES (new_week, new_type, new_name, actual_start, actual_end, 
          CASE WHEN actual_start <= NOW() AND actual_end > NOW() THEN 'active' ELSE 'upcoming' END)
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
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

-- Enable realtime
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE tournament_entries;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
