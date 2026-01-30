-- Game settings table for configurable parameters
-- Allows storing settings like agent limits without schema changes

CREATE TABLE IF NOT EXISTS game_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_game_settings_key ON game_settings(key);

-- Insert default agent limit (1000 agents)
INSERT INTO game_settings (key, value) 
VALUES ('agent_limit', '1000')
ON CONFLICT (key) DO NOTHING;

-- Function to auto-update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_game_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on changes
DROP TRIGGER IF EXISTS trigger_update_game_settings_timestamp ON game_settings;
CREATE TRIGGER trigger_update_game_settings_timestamp
  BEFORE UPDATE ON game_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_game_settings_timestamp();

-- Enable RLS
ALTER TABLE game_settings ENABLE ROW LEVEL SECURITY;

-- Allow read access for anonymous users (to check limits)
CREATE POLICY "Allow anonymous read access to game_settings" ON game_settings
  FOR SELECT USING (true);
