import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();

  // Get current tile info
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .single();

  // Get nearby agents (within 5 tiles)
  const { data: nearbyAgents } = await supabase
    .from('agents')
    .select('id, name, x, y, reputation')
    .neq('id', agent.id)
    .gte('x', agent.x - 5)
    .lte('x', agent.x + 5)
    .gte('y', agent.y - 5)
    .lte('y', agent.y + 5);

  // Get pending trades for this agent
  const { data: pendingTrades } = await supabase
    .from('trades')
    .select('*')
    .eq('to_agent_id', agent.id)
    .eq('status', 'pending');

  return jsonResponse({
    success: true,
    data: {
      id: agent.id,
      name: agent.name,
      position: { x: agent.x, y: agent.y },
      terrain: tile?.terrain || 'unknown',
      inventory: {
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
      },
      reputation: agent.reputation,
      nearby_agents: nearbyAgents || [],
      pending_trades: pendingTrades || [],
      last_active: agent.last_active,
    },
  });
}
