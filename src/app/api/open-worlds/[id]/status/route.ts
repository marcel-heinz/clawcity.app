import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateWealthBreakdown, AgentLeaderboard } from '@/lib/types';
import { errorResponse, jsonResponse } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        agents: [],
        events: [],
        leaderboard: [],
        topGatherers: [],
        recentlyJoined: [],
        stats: {
          total_agents: 0,
          active_agents: 0,
          total_trades: 0,
          total_territories: 0,
          top_gatherer: null,
        },
      },
    });
  }

  try {
    const { id: worldId } = await params;
    const supabase = createServerClient();
    const url = new URL(request.url);

    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const compact = url.searchParams.get('compact') === 'true';

    const { data: world } = await supabase
      .from('open_worlds')
      .select('id, name, status')
      .eq('id', worldId)
      .single();

    if (!world) {
      return errorResponse('Open world not found', 404);
    }

    const { data: rawAgents, error: agentsError } = await supabase
      .from('open_world_agent_state')
      .select('*')
      .eq('world_id', worldId)
      .order('reputation', { ascending: false })
      .limit(250);

    if (agentsError) {
      console.error('open-world status agents error:', agentsError);
      return errorResponse('Failed to fetch world agents', 500);
    }

    const agentIds = (rawAgents || []).map((a) => a.agent_id);
    const { data: agentRows } = agentIds.length
      ? await supabase.from('agents').select('id, name').in('id', agentIds)
      : { data: [] as { id: string; name: string }[] };

    const nameMap = new Map((agentRows || []).map((a) => [a.id, a.name]));

    const { data: tileData } = await supabase
      .from('open_world_tiles')
      .select('owner_id, building_type')
      .eq('world_id', worldId)
      .not('owner_id', 'is', null);

    const territoryMap = new Map<string, number>();
    const buildingMap = new Map<string, { storage: number; workshop: number; fortification: number }>();
    const buildingCountMap = new Map<string, number>();

    tileData?.forEach((t) => {
      if (!t.owner_id) return;
      territoryMap.set(t.owner_id, (territoryMap.get(t.owner_id) || 0) + 1);

      if (t.building_type) {
        const buildings = buildingMap.get(t.owner_id) || { storage: 0, workshop: 0, fortification: 0 };
        if (t.building_type === 'storage') buildings.storage++;
        if (t.building_type === 'workshop') buildings.workshop++;
        if (t.building_type === 'fortification') buildings.fortification++;
        buildingMap.set(t.owner_id, buildings);
        buildingCountMap.set(t.owner_id, (buildingCountMap.get(t.owner_id) || 0) + 1);
      }
    });

    const { data: itemCountData } = await supabase
      .from('open_world_agent_items')
      .select('agent_id, quantity')
      .eq('world_id', worldId)
      .gt('quantity', 0);

    const itemCountMap = new Map<string, number>();
    itemCountData?.forEach((item) => {
      itemCountMap.set(item.agent_id, (itemCountMap.get(item.agent_id) || 0) + (item.quantity || 0));
    });

    const agents: AgentLeaderboard[] = (rawAgents || []).map((agent) => {
      const totalGathered =
        (agent.total_gathered_gold || 0) +
        (agent.total_gathered_wood || 0) +
        (agent.total_gathered_food || 0) +
        (agent.total_gathered_stone || 0);

      const territory_count = territoryMap.get(agent.agent_id) || 0;
      const buildings = buildingMap.get(agent.agent_id) || { storage: 0, workshop: 0, fortification: 0 };
      const wealth = calculateWealthBreakdown({
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
        buildings,
        territory_count,
      });

      return {
        id: agent.agent_id,
        name: nameMap.get(agent.agent_id) || 'Unknown',
        x: agent.x,
        y: agent.y,
        reputation: agent.reputation,
        last_active: agent.last_active,
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
        wealth: wealth.total,
        resource_wealth: wealth.resource_wealth,
        infrastructure_wealth: wealth.infrastructure_wealth,
        territory_wealth: wealth.territory_wealth,
        territory_count,
        created_at: agent.created_at,
        total_gathered_gold: agent.total_gathered_gold || 0,
        total_gathered_wood: agent.total_gathered_wood || 0,
        total_gathered_food: agent.total_gathered_food || 0,
        total_gathered_stone: agent.total_gathered_stone || 0,
        total_gathered: totalGathered,
        item_count: itemCountMap.get(agent.agent_id) || 0,
        building_count: buildingCountMap.get(agent.agent_id) || 0,
        claimed: agent.claimed || false,
        claimed_by_twitter: agent.claimed_by_twitter || null,
      };
    });

    const leaderboard = [...agents]
      .sort((a, b) => b.wealth - a.wealth)
      .slice(0, 20)
      .map((agent, i) => ({ rank: i + 1, ...agent }));

    const topGatherers = [...agents]
      .sort((a, b) => (b.total_gathered || 0) - (a.total_gathered || 0))
      .slice(0, 10)
      .map((agent, i) => ({ rank: i + 1, ...agent }));

    const recentlyJoined = [...agents]
      .sort((a, b) => new Date((b.created_at as string) || 0).getTime() - new Date((a.created_at as string) || 0).getTime())
      .slice(0, 5)
      .map((a) => ({ id: a.id, name: a.name }));

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const [{ count: totalAgents }, { count: activeAgents }, { count: totalTrades }, { count: totalTerritories }] = await Promise.all([
      supabase
        .from('open_world_agent_state')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId),
      supabase
        .from('open_world_agent_state')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId)
        .gte('last_active', fiveMinutesAgo),
      supabase
        .from('open_world_trades')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId)
        .eq('status', 'accepted'),
      supabase
        .from('open_world_tiles')
        .select('*', { count: 'exact', head: true })
        .eq('world_id', worldId)
        .not('owner_id', 'is', null),
    ]);

    const stats = {
      total_agents: totalAgents || 0,
      active_agents: activeAgents || 0,
      total_trades: totalTrades || 0,
      total_territories: totalTerritories || 0,
      top_gatherer: topGatherers[0]?.name || null,
    };

    if (compact) {
      return jsonResponse({
        success: true,
        data: {
          world,
          leaderboard: leaderboard.map((a) => ({ rank: a.rank, name: a.name, wealth: a.wealth })),
          stats,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const { data: events } = await supabase
      .from('open_world_events')
      .select('id, agent_id, type, data, location, created_at')
      .eq('world_id', worldId)
      .order('created_at', { ascending: false })
      .limit(limit);

    const enrichedEvents = (events || []).map((event) => ({
      ...event,
      agent_name: nameMap.get(event.agent_id || '') || 'Unknown',
    }));

    return jsonResponse({
      success: true,
      data: {
        world,
        agents,
        events: enrichedEvents,
        leaderboard,
        topGatherers,
        recentlyJoined,
        stats,
      },
    });
  } catch (error) {
    console.error('open-world status exception:', error);
    return errorResponse('Internal server error', 500);
  }
}
