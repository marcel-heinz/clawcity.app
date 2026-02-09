import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { calculateWealthBreakdown } from '@/lib/types';

/**
 * GET /api/world/leaderboard
 *
 * Compact leaderboard endpoint — returns only essential ranking data.
 * Designed to minimize token usage vs /api/world/status which returns
 * full agent arrays, events, and stats.
 *
 * Response: ~500-800 chars for top 10 vs ~10,000+ chars from /api/world/status
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return jsonResponse({ success: true, data: { leaderboard: [], total_agents: 0 } });
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

    // Get agents with resources
    const { data: rawAgents, error } = await supabase
      .from('agents')
      .select('id, name, gold, wood, food, stone, reputation')
      .limit(100);

    if (error) {
      return errorResponse('Failed to fetch leaderboard', 500);
    }

    // Get territory and building counts
    const { data: tileData } = await supabase
      .from('tiles')
      .select('owner_id, building_type')
      .not('owner_id', 'is', null);

    const territoryMap = new Map<string, number>();
    const buildingMap = new Map<string, { storage: number; workshop: number; fortification: number }>();
    tileData?.forEach(t => {
      if (t.owner_id) {
        territoryMap.set(t.owner_id, (territoryMap.get(t.owner_id) || 0) + 1);
        if (t.building_type) {
          const buildings = buildingMap.get(t.owner_id) || { storage: 0, workshop: 0, fortification: 0 };
          if (t.building_type === 'storage') buildings.storage++;
          else if (t.building_type === 'workshop') buildings.workshop++;
          else if (t.building_type === 'fortification') buildings.fortification++;
          buildingMap.set(t.owner_id, buildings);
        }
      }
    });

    const { count: totalAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    // Calculate wealth and sort
    const leaderboard = (rawAgents || [])
      .map(agent => {
        const territory_count = territoryMap.get(agent.id) || 0;
        const buildings = buildingMap.get(agent.id) || { storage: 0, workshop: 0, fortification: 0 };
        const wb = calculateWealthBreakdown({ ...agent, buildings, territory_count });
        return { id: agent.id, name: agent.name, wealth: wb.total };
      })
      .sort((a, b) => b.wealth - a.wealth)
      .slice(0, limit)
      .map((agent, i) => ({ rank: i + 1, ...agent }));

    return jsonResponse({
      success: true,
      data: { leaderboard, total_agents: totalAgents || 0 },
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return errorResponse('Internal server error', 500);
  }
}
