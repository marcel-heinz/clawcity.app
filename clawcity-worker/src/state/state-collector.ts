import { getSupabase } from '../db/supabase-client';

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
}

export async function collectAgentState(agentId: string): Promise<AgentState | null> {
  const supabase = getSupabase();

  // Fetch agent
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, x, y, gold, wood, food, stone, reputation')
    .eq('id', agentId)
    .single();

  if (!agent) return null;

  // Fetch current tile
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain, resources, owner_id')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .single();

  // Fetch nearby agents (within 5 tiles)
  const radius = 5;
  const { data: nearbyAgents } = await supabase
    .from('agents')
    .select('id, name, x, y')
    .neq('id', agentId)
    .gte('x', agent.x - radius)
    .lte('x', agent.x + radius)
    .gte('y', agent.y - radius)
    .lte('y', agent.y + radius)
    .limit(20);

  // Fetch nearby tiles (3x3 area around agent)
  const tileRadius = 3;
  const { data: nearbyTiles } = await supabase
    .from('tiles')
    .select('x, y, terrain, resources, owner_id')
    .gte('x', agent.x - tileRadius)
    .lte('x', agent.x + tileRadius)
    .gte('y', agent.y - tileRadius)
    .lte('y', agent.y + tileRadius);

  // Fetch pending incoming trades
  const { data: trades } = await supabase
    .from('trades')
    .select('id, from_agent_id, offer, request')
    .eq('to_agent_id', agentId)
    .eq('status', 'pending')
    .limit(5);

  return {
    agent,
    currentTile: tile || { terrain: 'plains', resources: {}, owner_id: null },
    nearbyAgents: nearbyAgents || [],
    nearbyTiles: nearbyTiles || [],
    pendingTrades: trades || [],
  };
}
