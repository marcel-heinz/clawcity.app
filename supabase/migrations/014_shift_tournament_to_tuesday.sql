-- Shift existing upcoming tournament from Monday to Tuesday
-- This fixes the first tournament which was created for Feb 2 (Monday) instead of Feb 3 (Tuesday)

UPDATE tournaments 
SET 
  starts_at = starts_at + INTERVAL '1 day',
  ends_at = ends_at + INTERVAL '1 day'
WHERE status = 'upcoming';
