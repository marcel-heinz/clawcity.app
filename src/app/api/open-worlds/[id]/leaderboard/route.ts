import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateWealthBreakdown } from '@/lib/types';
import { errorResponse, jsonResponse } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return jsonResponse({ success: true, data: { leaderboard: [], total_agents: 0 } });
  }

  try {
    const { id: worldId } = await params;
    const supabase = createServerClient();
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));

    const { data: world } = await supabase
      .from('open_worlds')
      .select('id')
      .eq('id', worldId)
      .single();

    if (!world) {
      return errorResponse('Open world not found', 404);
    }

    const { data: rawAgents, error } = await supabase
      .from('open_world_agent_state')
      .select('agent_id, gold, wood, food, stone, reputation, last_active')
      .eq('world_id', worldId)
      .limit(1000);

    if (error) {
      console.error('open-world leaderboard agents error:', error);
      return errorResponse('Failed to fetch leaderboard', 500);
    }

    const agentIds = (rawAgents || []).map((a) => a.agent_id);
    const [{ data: owners }, { data: tileData }, { count: totalAgents }] = await Promise.all([
      agentIds.length
        ? supabase.from('agents').select('id, name').in('id', agentIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      supabase
        .from('open_world_tiles')
        .select('owner_id, building_type')
        .eq('world_id', worldId)
        .not('owner_id', 'is', null),
      supabase
        .from('open_world_agent_state')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId),
    ]);

    const ownerMap = new Map((owners || []).map((a) => [a.id, a.name]));
    const territoryMap = new Map<string, number>();
    const buildingMap = new Map<string, { storage: number; workshop: number; fortification: number }>();

    tileData?.forEach((tile) => {
      if (!tile.owner_id) return;
      territoryMap.set(tile.owner_id, (territoryMap.get(tile.owner_id) || 0) + 1);
      if (!tile.building_type) return;
      const buildings = buildingMap.get(tile.owner_id) || { storage: 0, workshop: 0, fortification: 0 };
      if (tile.building_type === 'storage') buildings.storage++;
      if (tile.building_type === 'workshop') buildings.workshop++;
      if (tile.building_type === 'fortification') buildings.fortification++;
      buildingMap.set(tile.owner_id, buildings);
    });

    const leaderboard = (rawAgents || [])
      .map((agent) => {
        const territoryCount = territoryMap.get(agent.agent_id) || 0;
        const buildings = buildingMap.get(agent.agent_id) || { storage: 0, workshop: 0, fortification: 0 };
        const wealth = calculateWealthBreakdown({
          gold: agent.gold,
          wood: agent.wood,
          food: agent.food,
          stone: agent.stone,
          buildings,
          territory_count: territoryCount,
        });

        return {
          id: agent.agent_id,
          name: ownerMap.get(agent.agent_id) || 'Unknown',
          wealth: wealth.total,
          resource_wealth: wealth.resource_wealth,
          infrastructure_wealth: wealth.infrastructure_wealth,
          territory_wealth: wealth.territory_wealth,
          reputation: agent.reputation,
          territory_count: territoryCount,
          last_active: agent.last_active,
          gold: agent.gold,
          wood: agent.wood,
          food: agent.food,
          stone: agent.stone,
        };
      })
      .sort((a, b) => b.wealth - a.wealth)
      .slice(0, limit)
      .map((agent, index) => ({ rank: index + 1, ...agent }));

    return jsonResponse({
      success: true,
      data: {
        leaderboard,
        total_agents: totalAgents || 0,
      },
    });
  } catch (error) {
    console.error('open-world leaderboard error:', error);
    return errorResponse('Internal server error', 500);
  }
}
