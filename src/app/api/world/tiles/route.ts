import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { generateWorldTiles, generateWorldTilesWithConfig } from '@/lib/game-logic';
import { WORLD_SIZE } from '@/lib/types';
import { getActiveWorldConfig } from '@/lib/world-runtime';

/**
 * Generate an array of sampled coordinates within a range
 * e.g., for min=0, max=499, sample=5 -> [0, 5, 10, ..., 495]
 */
function getSampledCoordinates(min: number, max: number, sample: number): number[] {
  const coords: number[] = [];
  // Start at the first coordinate divisible by sample that's >= min
  const start = Math.ceil(min / sample) * sample;
  for (let i = start; i <= max; i += sample) {
    coords.push(i);
  }
  return coords;
}

// GET tiles (with optional area filter)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sample = parseInt(url.searchParams.get('sample') || '1'); // Downsample factor (1 = no sampling)
  
  if (!isSupabaseConfigured) {
    // Return generated tiles for preview mode
    const tiles = generateWorldTiles();
    const x = parseInt(url.searchParams.get('x') || '25');
    const y = parseInt(url.searchParams.get('y') || '25');
    const radius = parseInt(url.searchParams.get('radius') || '15');

    let filteredTiles = tiles.filter(
      (t) =>
        t.x >= x - radius &&
        t.x <= x + radius &&
        t.y >= y - radius &&
        t.y <= y + radius
    );
    
    // Apply sampling if requested
    if (sample > 1) {
      filteredTiles = filteredTiles.filter(t => t.x % sample === 0 && t.y % sample === 0);
    }

    return jsonResponse({
      success: true,
      data: {
        tiles: filteredTiles,
        count: filteredTiles.length,
        preview: true,
      },
    });
  }

  try {
    const supabase = createServerClient();
    
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    const radius = parseInt(url.searchParams.get('radius') || '15');

    // For sampled world overview requests (large radius + sample > 1),
    // use a special query path that fetches only sampled coordinates
    // with pagination to bypass the Supabase row limit
    if (sample > 1 && x !== null && y !== null && radius >= 100) {
      const centerX = parseInt(x);
      const centerY = parseInt(y);
      
      // Compute bounds, clamped to world size
      const minX = Math.max(0, centerX - radius);
      const maxX = Math.min(WORLD_SIZE - 1, centerX + radius);
      const minY = Math.max(0, centerY - radius);
      const maxY = Math.min(WORLD_SIZE - 1, centerY + radius);
      
      // Get the sampled coordinate arrays
      const xCoords = getSampledCoordinates(minX, maxX, sample);
      const yCoords = getSampledCoordinates(minY, maxY, sample);
      
      // Expected tile count
      const expectedCount = xCoords.length * yCoords.length;
      
      // Fetch tiles with pagination (Supabase has a ~1000 row default limit)
      const PAGE_SIZE = 1000;
      const allTiles: Array<{ x: number; y: number; terrain: string; owner_id: string | null; building_type: string | null }> = [];
      let page = 0;

      while (allTiles.length < expectedCount) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data: pageTiles, error } = await supabase
          .from('tiles')
          .select('x, y, terrain, owner_id, building_type')
          .in('x', xCoords)
          .in('y', yCoords)
          .order('x', { ascending: true })
          .order('y', { ascending: true })
          .range(from, to);
        
        if (error) {
          console.error('Error fetching sampled tiles page:', error);
          return errorResponse('Failed to fetch tiles', 500);
        }
        
        if (!pageTiles || pageTiles.length === 0) {
          // No more tiles to fetch
          break;
        }
        
        allTiles.push(...pageTiles);
        page++;
        
        // Safety limit to prevent infinite loops
        if (page > 20) {
          console.warn('Hit pagination safety limit for sampled tiles');
          break;
        }
      }
      
      return jsonResponse({
        success: true,
        data: {
          tiles: allTiles,
          count: allTiles.length,
        },
      });
    }

    // summary=true returns terrain type counts instead of full tile array (saves ~90% tokens)
    const summary = url.searchParams.get('summary') === 'true';

    // Standard path for small-radius requests or no sampling.
    // Use pagination to avoid partial responses from backend row limits.
    const maxTiles = (radius * 2 + 1) * (radius * 2 + 1);
    const cappedMaxTiles = Math.min(maxTiles, 50000);
    const PAGE_SIZE = 1000;
    const allTiles: Array<{ x: number; y: number; terrain: string; owner_id: string | null; building_type: string | null }> = [];
    let page = 0;

    while (allTiles.length < cappedMaxTiles) {
      const from = page * PAGE_SIZE;
      if (from >= cappedMaxTiles) break;
      const to = Math.min(from + PAGE_SIZE - 1, cappedMaxTiles - 1);

      let pageQuery = supabase.from('tiles').select('x, y, terrain, owner_id, building_type');

      // Filter by area if coordinates provided
      if (x !== null && y !== null) {
        const centerX = parseInt(x);
        const centerY = parseInt(y);
        pageQuery = pageQuery
          .gte('x', centerX - radius)
          .lte('x', centerX + radius)
          .gte('y', centerY - radius)
          .lte('y', centerY + radius);
      }

      const { data: pageTiles, error } = await pageQuery
        .order('x', { ascending: true })
        .order('y', { ascending: true })
        .range(from, to);

      if (error) {
        console.error('Error fetching tiles:', error);
        return errorResponse('Failed to fetch tiles', 500);
      }

      if (!pageTiles || pageTiles.length === 0) break;
      allTiles.push(...pageTiles);

      // Stop early when final page is shorter than requested window.
      if (pageTiles.length < (to - from + 1)) break;
      page++;

      // Safety limit to prevent pathological loops.
      if (page > 1000) {
        console.warn('Hit pagination safety limit for standard tiles');
        break;
      }
    }

    // Apply client-requested sampling (for standard path requests)
    let resultTiles = allTiles;
    if (sample > 1) {
      resultTiles = resultTiles.filter(t => t.x % sample === 0 && t.y % sample === 0);
    }

    // Summary mode: return terrain counts + nearest of each type
    if (summary && x !== null && y !== null) {
      const centerX = parseInt(x);
      const centerY = parseInt(y);
      const terrainCounts: Record<string, number> = {};
      const nearest: Record<string, { x: number; y: number; dist: number }> = {};

      for (const t of resultTiles) {
        const terrain = t.terrain as string;
        terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;

        const dist = Math.abs(t.x - centerX) + Math.abs(t.y - centerY);
        if (!nearest[terrain] || dist < nearest[terrain].dist) {
          nearest[terrain] = { x: t.x, y: t.y, dist };
        }
      }

      // Strip dist from nearest
      const nearestClean: Record<string, { x: number; y: number }> = {};
      for (const [terrain, loc] of Object.entries(nearest)) {
        nearestClean[terrain] = { x: loc.x, y: loc.y };
      }

      return jsonResponse({
        success: true,
        data: {
          terrain_counts: terrainCounts,
          nearest: nearestClean,
          total: resultTiles.length,
          radius,
        },
      });
    }

    return jsonResponse({
      success: true,
      data: {
        tiles: resultTiles,
        count: resultTiles.length,
      },
    });
  } catch (error) {
    console.error('Tiles error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// POST to seed/reset tiles (admin only - requires service key)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  try {
    // Check for admin key (required for seeding)
    const authHeader = request.headers.get('authorization');
    const adminKey = process.env.ADMIN_KEY;
    
    if (!adminKey) {
      return errorResponse('ADMIN_KEY environment variable not configured', 503);
    }
    
    if (authHeader !== `Bearer ${adminKey}`) {
      return errorResponse('Unauthorized - admin access required', 401);
    }

    const supabase = createServerClient();
    const activeWorldConfig = await getActiveWorldConfig(supabase);

    // Generate tiles
    const tiles = generateWorldTilesWithConfig(activeWorldConfig);

    // Clear existing tiles
    await supabase.from('tiles').delete().neq('x', -999);

    // Insert new tiles in batches
    const batchSize = 500;
    for (let i = 0; i < tiles.length; i += batchSize) {
      const batch = tiles.slice(i, i + batchSize);
      const { error } = await supabase.from('tiles').insert(batch);
      if (error) {
        console.error('Error inserting tiles batch:', error);
        return errorResponse('Failed to seed tiles', 500);
      }
    }

    return jsonResponse({
      success: true,
      data: {
        message: `Seeded ${tiles.length} tiles`,
        count: tiles.length,
      },
    }, 201);
  } catch (error) {
    console.error('Seed error:', error);
    return errorResponse('Internal server error', 500);
  }
}
