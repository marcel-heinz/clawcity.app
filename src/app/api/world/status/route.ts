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
    // `limit` controls only the events array size in the response.
    const eventLimit = parseInt(url.searchParams.get('limit') || '20');
    // `agent_limit` controls the agents source pool size (default preserves legacy 100 cap).
    const parsedAgentLimit = parseInt(url.searchParams.get('agent_limit') || '100');
    const agentLimit = Number.isFinite(parsedAgentLimit)
      ? Math.min(1000, Math.max(1, parsedAgentLimit))
      : 100;
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    const radius = parseInt(url.searchParams.get('radius') || '10');
    // compact=true returns only leaderboard + stats (no agents array, no events)
    const compact = url.searchParams.get('compact') === 'true';

    const systemFlagProbe = await supabase
      .from('agents')
      .select('is_system')
      .limit(1);
    const supportsSystemFlag = !(
      systemFlagProbe.error &&
      systemFlagProbe.error.message?.includes('is_system')
    );

    // Get all agents with resources and gathering stats
    let agentsQuery = supabase
      .from('agents')
      .select('id, name, x, y, gold, wood, food, stone, reputation, last_active, created_at, total_gathered_gold, total_gathered_wood, total_gathered_food, total_gathered_stone, claimed, claimed_by_twitter, avatar')
      .order('reputation', { ascending: false });

    if (supportsSystemFlag) {
      agentsQuery = agentsQuery.eq('is_system', false);
    }

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

    const { data: rawAgents, error: agentsError } = await agentsQuery.limit(agentLimit);

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return errorResponse('Failed to fetch world status', 500);
    }

    const agentIds = (rawAgents || []).map((a) => a.id);
    let clawCreditMap = new Map<string, { balance: number; lifetime_earned: number; lifetime_spent: number }>();
    let claimableClawCreditMap = new Map<string, number>();
    const startedWeekResult = await supabase.rpc('current_started_tournament_week');
    const startedWeek = Number.isFinite(Number(startedWeekResult.data))
      ? Number(startedWeekResult.data)
      : 0;

    if (agentIds.length > 0) {
      const { data: wallets } = await supabase
        .from('claw_credit_wallets')
        .select('agent_id, balance, lifetime_earned, lifetime_spent')
        .in('agent_id', agentIds);

      clawCreditMap = new Map(
        (wallets || []).map((w) => [
          w.agent_id,
          {
            balance: Number(w.balance || 0),
            lifetime_earned: Number(w.lifetime_earned || 0),
            lifetime_spent: Number(w.lifetime_spent || 0),
          },
        ]),
      );

      const { data: claimableRewards } = await supabase
        .from('claw_credit_rewards')
        .select('agent_id, amount')
        .in('agent_id', agentIds)
        .is('claimed_at', null)
        .lte('unlock_week_number', startedWeek);

      claimableClawCreditMap = new Map();
      for (const row of claimableRewards || []) {
        const amount = Number(row.amount || 0);
        claimableClawCreditMap.set(row.agent_id, (claimableClawCreditMap.get(row.agent_id) || 0) + amount);
      }
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
      const clawCredits = clawCreditMap.get(agent.id) || {
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0,
      };
      const claimableClawCredits = claimableClawCreditMap.get(agent.id) || 0;

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
        claw_credits: clawCredits.balance,
        claw_credits_claimable: claimableClawCredits,
        claw_credits_lifetime_earned: clawCredits.lifetime_earned,
        claw_credits_lifetime_spent: clawCredits.lifetime_spent,
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
        claw_credits: agent.claw_credits || 0,
        claw_credits_claimable: agent.claw_credits_claimable || 0,
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

    // Get world stats
    let totalAgentsQuery = supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });
    if (supportsSystemFlag) {
      totalAgentsQuery = totalAgentsQuery.eq('is_system', false);
    }
    const { count: totalAgents } = await totalAgentsQuery;

    // Count active agents (active in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let activeAgentsQuery = supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .gte('last_active', fiveMinutesAgo);
    if (supportsSystemFlag) {
      activeAgentsQuery = activeAgentsQuery.eq('is_system', false);
    }
    const { count: activeAgents } = await activeAgentsQuery;

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

    // Get top gatherer
    const topGatherer = topGatherers.length > 0 ? topGatherers[0] : null;

    const stats = {
      total_agents: totalAgents || 0,
      active_agents: activeAgents || 0,
      total_trades: totalTrades || 0,
      total_territories: totalTerritories || 0,
      top_gatherer: topGatherer ? topGatherer.name : null,
    };

    // Compact mode: leaderboard + stats only (saves ~5-20k tokens)
    if (compact) {
      return jsonResponse({
        success: true,
        data: {
          leaderboard: leaderboard.map(a => ({ rank: a.rank, name: a.name, wealth: a.wealth })),
          stats,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // Full mode: includes agents array, events, resources
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
      .limit(eventLimit);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return errorResponse('Failed to fetch events', 500);
    }

    // Enrich events with agent names.
    // Resolve missing IDs from the DB so event labels don't depend on agent_limit.
    const agentMap = new Map(agents.map(a => [a.id, a.name]));
    const missingEventAgentIds = Array.from(
      new Set(
        (events || [])
          .map(event => event.agent_id)
          .filter((agentId) => !!agentId && !agentMap.has(agentId))
      )
    );

    if (missingEventAgentIds.length > 0) {
      let missingEventAgentsQuery = supabase
        .from('agents')
        .select('id, name')
        .in('id', missingEventAgentIds);
      if (supportsSystemFlag) {
        missingEventAgentsQuery = missingEventAgentsQuery.eq('is_system', false);
      }
      const { data: missingEventAgents, error: missingEventAgentsError } = await missingEventAgentsQuery;

      if (missingEventAgentsError) {
        console.error('Error resolving event agent names:', missingEventAgentsError);
      } else {
        missingEventAgents?.forEach(agent => {
          if (agent.id && agent.name) {
            agentMap.set(agent.id, agent.name);
          }
        });
      }
    }

    const enrichedEvents = (events || [])
      .filter((event) => agentMap.has(event.agent_id))
      .map(e => ({
        ...e,
        agent_name: agentMap.get(e.agent_id) || 'Unknown',
      }));

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

    return jsonResponse({
      success: true,
      data: {
        agents,
        leaderboard,
        topGatherers,
        recentlyJoined,
        events: enrichedEvents,
        stats: {
          ...stats,
          total_resources: totalResources,
          mining_activity_last_hour: miningActivity || 0,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('World status error:', error);
    return errorResponse('Internal server error', 500);
  }
}
