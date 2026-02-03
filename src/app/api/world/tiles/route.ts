import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { generateWorldTiles } from '@/lib/game-logic';

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

    let query = supabase.from('tiles').select('x, y, terrain, owner_id');

    // Filter by area if coordinates provided
    if (x !== null && y !== null) {
      const centerX = parseInt(x);
      const centerY = parseInt(y);
      query = query
        .gte('x', centerX - radius)
        .lte('x', centerX + radius)
        .gte('y', centerY - radius)
        .lte('y', centerY + radius);
    }
    
    // Increase limit for larger requests
    const maxTiles = (radius * 2 + 1) * (radius * 2 + 1);
    query = query.limit(Math.min(maxTiles, 50000));

    const { data: tiles, error } = await query;

    if (error) {
      console.error('Error fetching tiles:', error);
      return errorResponse('Failed to fetch tiles', 500);
    }
    
    // Apply client-requested sampling
    let resultTiles = tiles || [];
    if (sample > 1) {
      resultTiles = resultTiles.filter(t => t.x % sample === 0 && t.y % sample === 0);
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

    // Generate tiles
    const tiles = generateWorldTiles();

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
