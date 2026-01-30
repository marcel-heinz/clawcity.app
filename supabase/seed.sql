-- Seed the world with tiles
-- This generates a 500x500 world with varied terrain

DO $$
DECLARE
  x_pos INT;
  y_pos INT;
  terrain_type TEXT;
  rand_val FLOAT;
  is_market BOOLEAN;
  is_water BOOLEAN;
  dist FLOAT;
  mx INT;
  my INT;
BEGIN
  -- Clear existing tiles
  DELETE FROM tiles;
  
  FOR y_pos IN 0..499 LOOP
    FOR x_pos IN 0..499 LOOP
      -- Generate pseudo-random value based on position
      rand_val := (sin(x_pos * 12.9898 + y_pos * 78.233 + 42) * 43758.5453);
      rand_val := rand_val - floor(rand_val);
      
      -- Check for markets (25 markets in a 5x5 grid pattern)
      is_market := FALSE;
      FOR mx IN 0..4 LOOP
        FOR my IN 0..4 LOOP
          IF x_pos = (50 + mx * 100) AND y_pos = (50 + my * 100) THEN
            is_market := TRUE;
          END IF;
        END LOOP;
      END LOOP;
      
      -- Check for water bodies (lakes and rivers)
      is_water := FALSE;
      
      -- Lake at (100, 100) radius 30
      dist := sqrt(power(x_pos - 100, 2) + power(y_pos - 100, 2));
      IF dist <= 30 THEN is_water := TRUE; END IF;
      
      -- Lake at (400, 100) radius 25
      dist := sqrt(power(x_pos - 400, 2) + power(y_pos - 100, 2));
      IF dist <= 25 THEN is_water := TRUE; END IF;
      
      -- Lake at (100, 400) radius 25
      dist := sqrt(power(x_pos - 100, 2) + power(y_pos - 400, 2));
      IF dist <= 25 THEN is_water := TRUE; END IF;
      
      -- Lake at (400, 400) radius 30
      dist := sqrt(power(x_pos - 400, 2) + power(y_pos - 400, 2));
      IF dist <= 30 THEN is_water := TRUE; END IF;
      
      -- Central lake at (250, 250) radius 40
      dist := sqrt(power(x_pos - 250, 2) + power(y_pos - 250, 2));
      IF dist <= 40 THEN is_water := TRUE; END IF;
      
      -- Horizontal river at y=200
      IF abs(y_pos - 200) <= 5 AND x_pos > 50 AND x_pos < 450 THEN
        is_water := TRUE;
      END IF;
      
      -- Vertical river at x=300
      IF abs(x_pos - 300) <= 5 AND y_pos > 100 AND y_pos < 400 THEN
        is_water := TRUE;
      END IF;
      
      -- Determine terrain type
      IF is_market THEN
        terrain_type := 'market';
      ELSIF is_water THEN
        terrain_type := 'water';
      -- Mountains in corners and mountain ranges
      ELSIF rand_val < 0.08 OR 
            (x_pos < 20 AND y_pos < 20) OR 
            (x_pos > 479 AND y_pos > 479) OR
            (x_pos < 20 AND y_pos > 479) OR
            (x_pos > 479 AND y_pos < 20) OR
            (abs(y_pos - x_pos) < 10 AND x_pos > 150 AND x_pos < 350) THEN
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
    
    -- Progress indicator every 50 rows
    IF y_pos % 50 = 0 THEN
      RAISE NOTICE 'Processed row %/500', y_pos;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Seeded % tiles', 500 * 500;
END $$;
