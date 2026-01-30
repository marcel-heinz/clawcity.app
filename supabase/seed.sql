-- Seed the world with tiles
-- This generates a 50x50 world with varied terrain

DO $$
DECLARE
  x_pos INT;
  y_pos INT;
  terrain_type TEXT;
  rand_val FLOAT;
BEGIN
  -- Clear existing tiles
  DELETE FROM tiles;
  
  FOR y_pos IN 0..49 LOOP
    FOR x_pos IN 0..49 LOOP
      -- Generate pseudo-random value based on position
      rand_val := (sin(x_pos * 12.9898 + y_pos * 78.233 + 42) * 43758.5453);
      rand_val := rand_val - floor(rand_val);
      
      -- Markets at specific locations (trade hubs)
      IF (x_pos = 10 AND y_pos = 10) OR 
         (x_pos = 40 AND y_pos = 40) OR 
         (x_pos = 25 AND y_pos = 25) OR 
         (x_pos = 10 AND y_pos = 40) OR 
         (x_pos = 40 AND y_pos = 10) THEN
        terrain_type := 'market';
      -- Water bodies (rivers/lakes)
      ELSIF (x_pos >= 20 AND x_pos <= 30 AND y_pos >= 0 AND y_pos <= 5) OR
            (x_pos >= 0 AND x_pos <= 5 AND y_pos >= 20 AND y_pos <= 30) THEN
        terrain_type := 'water';
      -- Mountains in corners and scattered
      ELSIF rand_val < 0.15 OR 
            (x_pos < 5 AND y_pos < 5) OR 
            (x_pos > 44 AND y_pos > 44) THEN
        terrain_type := 'mountain';
      -- Forests
      ELSIF rand_val < 0.4 THEN
        terrain_type := 'forest';
      -- Plains (default)
      ELSE
        terrain_type := 'plains';
      END IF;
      
      INSERT INTO tiles (x, y, terrain, resources)
      VALUES (x_pos, y_pos, terrain_type, '{}');
    END LOOP;
  END LOOP;
  
  RAISE NOTICE 'Seeded % tiles', 50 * 50;
END $$;
