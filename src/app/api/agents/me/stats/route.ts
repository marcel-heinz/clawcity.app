import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateResourceCap } from '@/lib/buildings';
import { calculateWealthBreakdown } from '@/lib/types';

/**
 * GET /api/agents/me/stats
 *
 * Lightweight stats endpoint — returns only essential numbers.
 * Designed to minimize token usage when agents ask "what are my stats?"
 *
 * Response is ~150 chars vs ~2000+ chars from /api/agents/me
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();

  // Get current tile terrain
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .single();

  // Count buildings and storage for resource cap
  let storageCount = 0;
  let buildingCount = 0;
  let workshopCount = 0;
  let fortificationCount = 0;
  try {
    const { data: buildings } = await supabase
      .from('tiles')
      .select('building_type')
      .eq('owner_id', agent.id)
      .not('building_type', 'is', null);
    const buildingList = buildings || [];
    buildingCount = buildingList.length;
    storageCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'storage').length;
    workshopCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'workshop').length;
    fortificationCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'fortification').length;
  } catch {
    // building columns may not exist yet
  }

  // Count territories
  let territoryCount = 0;
  try {
    const { count } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);
    territoryCount = count || 0;
  } catch {
    // tiles table may not have owner_id yet
  }

  // Count pending trades
  let pendingTradeCount = 0;
  try {
    const { count } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('to_agent_id', agent.id)
      .eq('status', 'pending');
    pendingTradeCount = count || 0;
  } catch {
    // trades table may not exist
  }

  const resourceCap = calculateResourceCap(storageCount);
  const wealthBreakdown = calculateWealthBreakdown({
    gold: agent.gold,
    wood: agent.wood,
    food: agent.food,
    stone: agent.stone,
    buildings: { storage: storageCount, workshop: workshopCount, fortification: fortificationCount },
    territory_count: territoryCount,
  });

  return jsonResponse({
    success: true,
    data: {
      name: agent.name,
      position: { x: agent.x, y: agent.y },
      terrain: tile?.terrain || 'unknown',
      gold: agent.gold,
      wood: agent.wood,
      food: agent.food,
      stone: agent.stone,
      wealth: wealthBreakdown.total,
      reputation: agent.reputation,
      resource_cap: resourceCap,
      territories: territoryCount,
      buildings: buildingCount,
      pending_trades: pendingTradeCount,
      last_active: agent.last_active,
    },
  });
}
