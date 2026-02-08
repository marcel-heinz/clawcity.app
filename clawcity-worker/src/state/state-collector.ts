import { getSupabase } from '../db/supabase-client';
import { apiRequest } from '../execution/api-client';
import { logger } from '../monitoring/logger';

export interface AgentState {
  agent: {
    id: string;
    name: string;
    x: number;
    y: number;
    gold: number;
    wood: number;
    food: number;
    stone: number;
    reputation: number;
    resource_cap: number;
  };
  currentTile: {
    terrain: string;
    resources: Record<string, number>;
    owner_id: string | null;
  };
  nearbyAgents: Array<{ id: string; name: string; x: number; y: number }>;
  nearbyTiles: Array<{
    x: number;
    y: number;
    terrain: string;
    resources: Record<string, number>;
    owner_id: string | null;
  }>;
  pendingTrades: Array<{
    id: string;
    from_agent_id: string;
    offer: Record<string, number>;
    request: Record<string, number>;
  }>;
  territories: Array<{
    x: number;
    y: number;
    terrain: string;
    level: number;
    building?: string;
  }>;
  buildings: Array<{
    type: string;
    x: number;
    y: number;
  }>;
  items: Array<{
    id: string;
    type: string;
    durability: number;
  }>;
  tournament: {
    active: boolean;
    type?: string;
    scoring?: string;
    rank?: number;
    score?: number;
    ends_at?: string;
    time_remaining?: string;
  } | null;
  events: Array<{
    type: string;
    effect: string;
    x: number;
    y: number;
    radius: number;
    expires_at: string;
  }>;
}

export async function collectAgentState(agentId: string, apiKey?: string): Promise<AgentState | null> {
  const supabase = getSupabase();

  // Fetch agent basics from DB
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, x, y, gold, wood, food, stone, reputation')
    .eq('id', agentId)
    .single();

  if (!agent) return null;

  // Parallel DB queries for core spatial data
  const [tileResult, nearbyAgentsResult, nearbyTilesResult, tradesResult] = await Promise.all([
    supabase
      .from('tiles')
      .select('terrain, resources, owner_id')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single(),
    supabase
      .from('agents')
      .select('id, name, x, y')
      .neq('id', agentId)
      .gte('x', agent.x - 5)
      .lte('x', agent.x + 5)
      .gte('y', agent.y - 5)
      .lte('y', agent.y + 5)
      .limit(20),
    supabase
      .from('tiles')
      .select('x, y, terrain, resources, owner_id')
      .gte('x', agent.x - 3)
      .lte('x', agent.x + 3)
      .gte('y', agent.y - 3)
      .lte('y', agent.y + 3),
    supabase
      .from('trades')
      .select('id, from_agent_id, offer, request')
      .eq('to_agent_id', agentId)
      .eq('status', 'pending')
      .limit(5),
  ]);

  // Extended data via API (needs apiKey)
  let territories: AgentState['territories'] = [];
  let buildings: AgentState['buildings'] = [];
  let items: AgentState['items'] = [];
  let resourceCap = 500;
  let tournament: AgentState['tournament'] = null;
  let events: AgentState['events'] = [];

  if (apiKey) {
    const [profileResult, tournamentResult, eventsResult] = await Promise.allSettled([
      apiRequest('/api/agents/me', apiKey),
      apiRequest('/api/tournaments', apiKey),
      apiRequest('/api/world/events', apiKey),
    ]);

    // Profile -> territories, buildings, items, resource_cap
    if (profileResult.status === 'fulfilled' && profileResult.value.success) {
      const profile = profileResult.value.data as Record<string, unknown> | undefined;
      if (profile) {
        territories = (profile.territories as AgentState['territories']) || [];
        buildings = (profile.buildings as AgentState['buildings']) || [];
        items = (profile.items as AgentState['items']) || [];
        resourceCap = (profile.resource_cap as number) || 500;
      }
    }

    // Tournament
    if (tournamentResult.status === 'fulfilled' && tournamentResult.value.success) {
      const tData = tournamentResult.value.data as Record<string, unknown> | undefined;
      if (tData) {
        const current = tData.current as Record<string, unknown> | undefined;
        if (current) {
          const endsAt = current.ends_at as string | undefined;
          let timeRemaining: string | undefined;
          if (endsAt) {
            const ms = new Date(endsAt).getTime() - Date.now();
            if (ms > 0) {
              const hours = Math.floor(ms / 3600000);
              const minutes = Math.floor((ms % 3600000) / 60000);
              timeRemaining = `${hours}h ${minutes}m`;
            }
          }

          const participants = current.participants as Array<Record<string, unknown>> | undefined;
          let rank: number | undefined;
          let score: number | undefined;
          if (participants) {
            const me = participants.find((p) => p.agent_id === agentId);
            if (me) {
              rank = me.rank as number;
              score = me.score as number;
            }
          }

          tournament = {
            active: true,
            type: current.type as string,
            scoring: current.scoring_description as string,
            rank,
            score,
            ends_at: endsAt,
            time_remaining: timeRemaining,
          };
        } else {
          tournament = { active: false };
        }
      }
    }

    // Events
    if (eventsResult.status === 'fulfilled' && eventsResult.value.success) {
      const eData = eventsResult.value.data as Array<Record<string, unknown>> | undefined;
      if (eData) {
        events = eData.map((e) => ({
          type: e.type as string,
          effect: e.effect as string,
          x: e.x as number,
          y: e.y as number,
          radius: e.radius as number,
          expires_at: e.expires_at as string,
        }));
      }
    }
  } else {
    logger.debug('No API key for state collector, skipping extended data');
  }

  return {
    agent: { ...agent, resource_cap: resourceCap },
    currentTile: tileResult.data || { terrain: 'plains', resources: {}, owner_id: null },
    nearbyAgents: nearbyAgentsResult.data || [],
    nearbyTiles: nearbyTilesResult.data || [],
    pendingTrades: tradesResult.data || [],
    territories,
    buildings,
    items,
    tournament,
    events,
  };
}
