import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { calculateWealthBreakdown, AgentLeaderboard } from '@/lib/types';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        agents: [],
        events: [],
        stats: {
          total_agents: 0,
          active_agents: 0,
          total_trades: 0,
          total_territories: 0,
          total_resources: { gold: 0, wood: 0, food: 0, stone: 0 },
          mining_activity_last_hour: 0,
          top_gatherer: null,
        },
        timestamp: new Date().toISOString(),
        message: 'Database not configured. Please set up Supabase.',
      },
    });
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    
    // Optional query params for filtering
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    const radius = parseInt(url.searchParams.get('radius') || '10');

    // Get all agents with resources and gathering stats
    let agentsQuery = supabase
      .from('agents')
      .select('id, name, x, y, gold, wood, food, stone, reputation, last_active, created_at, total_gathered_gold, total_gathered_wood, total_gathered_food, total_gathered_stone, claimed, claimed_by_twitter')
      .order('reputation', { ascending: false });

    // Filter by area if coordinates provided
    if (x !== null && y !== null) {
      const centerX = parseInt(x);
      const centerY = parseInt(y);
      agentsQuery = agentsQuery
        .gte('x', centerX - radius)
        .lte('x', centerX + radius)
        .gte('y', centerY - radius)
        .lte('y', centerY + radius);
    }

    const { data: rawAgents, error: agentsError } = await agentsQuery.limit(100);

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return errorResponse('Failed to fetch world status', 500);
    }

    // Get territory counts and building counts for all agents
    const { data: tileData } = await supabase
      .from('tiles')
      .select('owner_id, building_type')
      .not('owner_id', 'is', null);

    // Count territories and buildings per agent
    const territoryMap = new Map<string, number>();
    const buildingMap = new Map<string, { storage: number; workshop: number; fortification: number }>();
    const buildingCountMap = new Map<string, number>();
    tileData?.forEach(t => {
      if (t.owner_id) {
        territoryMap.set(t.owner_id, (territoryMap.get(t.owner_id) || 0) + 1);
        if (t.building_type) {
          const buildings = buildingMap.get(t.owner_id) || { storage: 0, workshop: 0, fortification: 0 };
          if (t.building_type === 'storage') buildings.storage++;
          else if (t.building_type === 'workshop') buildings.workshop++;
          else if (t.building_type === 'fortification') buildings.fortification++;
          buildingMap.set(t.owner_id, buildings);
          buildingCountMap.set(t.owner_id, (buildingCountMap.get(t.owner_id) || 0) + 1);
        }
      }
    });

    // Get item counts per agent
    const { data: itemCountData } = await supabase
      .from('agent_items')
      .select('agent_id, quantity')
      .gt('quantity', 0);

    const itemCountMap = new Map<string, number>();
    itemCountData?.forEach(item => {
      if (item.agent_id) {
        itemCountMap.set(item.agent_id, (itemCountMap.get(item.agent_id) || 0) + (item.quantity || 0));
      }
    });

    // Calculate wealth (Net Worth), territory count, and total gathered for each agent
    const agents: AgentLeaderboard[] = (rawAgents || []).map(agent => {
      const totalGathered =
        (agent.total_gathered_gold || 0) +
        (agent.total_gathered_wood || 0) +
        (agent.total_gathered_food || 0) +
        (agent.total_gathered_stone || 0);

      const territory_count = territoryMap.get(agent.id) || 0;
      const buildings = buildingMap.get(agent.id) || { storage: 0, workshop: 0, fortification: 0 };
      const wealthBreakdown = calculateWealthBreakdown({
        ...agent,
        buildings,
        territory_count,
      });

      return {
        ...agent,
        wealth: wealthBreakdown.total,
        resource_wealth: wealthBreakdown.resource_wealth,
        infrastructure_wealth: wealthBreakdown.infrastructure_wealth,
        territory_wealth: wealthBreakdown.territory_wealth,
        territory_count,
        total_gathered_gold: agent.total_gathered_gold || 0,
        total_gathered_wood: agent.total_gathered_wood || 0,
        total_gathered_food: agent.total_gathered_food || 0,
        total_gathered_stone: agent.total_gathered_stone || 0,
        total_gathered: totalGathered,
        item_count: itemCountMap.get(agent.id) || 0,
        building_count: buildingCountMap.get(agent.id) || 0,
        claimed: agent.claimed || false,
        claimed_by_twitter: agent.claimed_by_twitter || null,
      };
    });

    // Create leaderboard sorted by wealth
    const leaderboard = [...agents]
      .sort((a, b) => b.wealth - a.wealth)
      .slice(0, 20)
      .map((agent, index) => ({
        rank: index + 1,
        id: agent.id,
        name: agent.name,
        wealth: agent.wealth,
        // Wealth breakdown (Net Worth)
        resource_wealth: agent.resource_wealth,
        infrastructure_wealth: agent.infrastructure_wealth,
        territory_wealth: agent.territory_wealth,
        reputation: agent.reputation,
        territory_count: agent.territory_count,
        last_active: agent.last_active,
        total_gathered: agent.total_gathered,
        // Resource breakdown for expanded view
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
        total_gathered_gold: agent.total_gathered_gold,
        total_gathered_wood: agent.total_gathered_wood,
        total_gathered_food: agent.total_gathered_food,
        total_gathered_stone: agent.total_gathered_stone,
      }));

    // Create top gatherers leaderboard
    const topGatherers = [...agents]
      .sort((a, b) => (b.total_gathered || 0) - (a.total_gathered || 0))
      .slice(0, 10)
      .map((agent, index) => ({
        rank: index + 1,
        id: agent.id,
        name: agent.name,
        total_gathered: agent.total_gathered || 0,
        total_gathered_gold: agent.total_gathered_gold || 0,
        total_gathered_wood: agent.total_gathered_wood || 0,
        total_gathered_food: agent.total_gathered_food || 0,
        total_gathered_stone: agent.total_gathered_stone || 0,
      }));

    // Create recently joined list (5 newest agents by created_at)
    const recentlyJoined = [...agents]
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      .slice(0, 5)
      .map(agent => ({
        id: agent.id,
        name: agent.name,
      }));

    // Get recent events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(`
        id,
        agent_id,
        type,
        data,
        location,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return errorResponse('Failed to fetch events', 500);
    }

    // Enrich events with agent names
    const agentMap = new Map(agents.map(a => [a.id, a.name]));
    const enrichedEvents = events?.map(e => ({
      ...e,
      agent_name: agentMap.get(e.agent_id) || 'Unknown',
    })) || [];

    // Get world stats
    const { count: totalAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    // Count active agents (active in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: activeAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .gte('last_active', fiveMinutesAgo);

    // Count completed trades
    const { count: totalTrades } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted');

    // Count total claimed territories
    const { count: totalTerritories } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .not('owner_id', 'is', null);

    // Calculate total resources in the world (sum across all agents)
    const totalResources = agents.reduce((acc, agent) => ({
      gold: acc.gold + (agent.gold || 0),
      wood: acc.wood + (agent.wood || 0),
      food: acc.food + (agent.food || 0),
      stone: acc.stone + (agent.stone || 0),
    }), { gold: 0, wood: 0, food: 0, stone: 0 });

    // Count gather events in the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: miningActivity } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'gather')
      .gte('created_at', oneHourAgo);

    // Get top gatherer
    const topGatherer = topGatherers.length > 0 ? topGatherers[0] : null;

    return jsonResponse({
      success: true,
      data: {
        agents,
        leaderboard,
        topGatherers,
        recentlyJoined,
        events: enrichedEvents,
        stats: {
          total_agents: totalAgents || 0,
          active_agents: activeAgents || 0,
          total_trades: totalTrades || 0,
          total_territories: totalTerritories || 0,
          total_resources: totalResources,
          mining_activity_last_hour: miningActivity || 0,
          top_gatherer: topGatherer ? topGatherer.name : null,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('World status error:', error);
    return errorResponse('Internal server error', 500);
  }
}
