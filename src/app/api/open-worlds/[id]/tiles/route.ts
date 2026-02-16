import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';
import { WORLD_SIZE } from '@/lib/types';

function getSampledCoordinates(min: number, max: number, sample: number): number[] {
  const coords: number[] = [];
  const start = Math.ceil(min / sample) * sample;
  for (let i = start; i <= max; i += sample) {
    coords.push(i);
  }
  return coords;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const { id: worldId } = await params;
    const supabase = createServerClient();
    const url = new URL(request.url);

    const sample = parseInt(url.searchParams.get('sample') || '1', 10);
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    const radius = parseInt(url.searchParams.get('radius') || '15', 10);
    const summary = url.searchParams.get('summary') === 'true';

    const { data: world } = await supabase
      .from('open_worlds')
      .select('id')
      .eq('id', worldId)
      .single();

    if (!world) {
      return errorResponse('Open world not found', 404);
    }

    if (sample > 1 && x !== null && y !== null && radius >= 100) {
      const centerX = parseInt(x, 10);
      const centerY = parseInt(y, 10);

      const minX = Math.max(0, centerX - radius);
      const maxX = Math.min(WORLD_SIZE - 1, centerX + radius);
      const minY = Math.max(0, centerY - radius);
      const maxY = Math.min(WORLD_SIZE - 1, centerY + radius);

      const xCoords = getSampledCoordinates(minX, maxX, sample);
      const yCoords = getSampledCoordinates(minY, maxY, sample);
      const expectedCount = xCoords.length * yCoords.length;

      const PAGE_SIZE = 1000;
      const allTiles: Array<{ x: number; y: number; terrain: string; owner_id: string | null; building_type: string | null }> = [];
      let page = 0;

      while (allTiles.length < expectedCount) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        const { data: pageTiles, error } = await supabase
          .from('open_world_tiles')
          .select('x, y, terrain, owner_id, building_type')
          .eq('world_id', worldId)
          .in('x', xCoords)
          .in('y', yCoords)
          .order('x', { ascending: true })
          .order('y', { ascending: true })
          .range(from, to);

        if (error) {
          console.error('open-world tiles sampled page error:', error);
          return errorResponse('Failed to fetch tiles', 500);
        }

        if (!pageTiles || pageTiles.length === 0) break;
        allTiles.push(...pageTiles);
        page += 1;
        if (page > 20) break;
      }

      return jsonResponse({ success: true, data: { tiles: allTiles, count: allTiles.length } });
    }

    const maxTiles = (radius * 2 + 1) * (radius * 2 + 1);
    const cappedMaxTiles = Math.min(maxTiles, 50000);
    const PAGE_SIZE = 1000;
    const allTiles: Array<{ x: number; y: number; terrain: string; owner_id: string | null; building_type: string | null }> = [];
    let page = 0;

    while (allTiles.length < cappedMaxTiles) {
      const from = page * PAGE_SIZE;
      if (from >= cappedMaxTiles) break;
      const to = Math.min(from + PAGE_SIZE - 1, cappedMaxTiles - 1);

      let pageQuery = supabase
        .from('open_world_tiles')
        .select('x, y, terrain, owner_id, building_type')
        .eq('world_id', worldId);

      if (x !== null && y !== null) {
        const centerX = parseInt(x, 10);
        const centerY = parseInt(y, 10);
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
        console.error('open-world tiles page error:', error);
        return errorResponse('Failed to fetch tiles', 500);
      }

      if (!pageTiles || pageTiles.length === 0) break;
      allTiles.push(...pageTiles);
      if (pageTiles.length < to - from + 1) break;
      page += 1;
      if (page > 1000) break;
    }

    let resultTiles = allTiles;
    if (sample > 1) {
      resultTiles = resultTiles.filter((t) => t.x % sample === 0 && t.y % sample === 0);
    }

    if (summary && x !== null && y !== null) {
      const centerX = parseInt(x, 10);
      const centerY = parseInt(y, 10);
      const terrainCounts: Record<string, number> = {};
      const nearest: Record<string, { x: number; y: number; dist: number }> = {};

      for (const tile of resultTiles) {
        terrainCounts[tile.terrain] = (terrainCounts[tile.terrain] || 0) + 1;
        const dist = Math.abs(tile.x - centerX) + Math.abs(tile.y - centerY);
        if (!nearest[tile.terrain] || dist < nearest[tile.terrain].dist) {
          nearest[tile.terrain] = { x: tile.x, y: tile.y, dist };
        }
      }

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

    return jsonResponse({ success: true, data: { tiles: resultTiles, count: resultTiles.length } });
  } catch (error) {
    console.error('open-world tiles error:', error);
    return errorResponse('Internal server error', 500);
  }
}
