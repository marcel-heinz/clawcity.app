import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateResourceCap } from '@/lib/buildings';
import { calculateWealthBreakdown } from '@/lib/types';

/**
 * GET /api/agents/me/summary
 *
 * Returns a pre-formatted one-line text summary of agent stats.
 * Designed for minimal token usage — the LLM can return this directly
 * without any JSON parsing or formatting.
 *
 * Response: ~100 chars plain text vs ~2000+ chars JSON from /api/agents/me
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

  // Count buildings and storage
  let storageCount = 0;
  let workshopCount = 0;
  let fortificationCount = 0;
  try {
    const { data: buildings } = await supabase
      .from('tiles')
      .select('building_type')
      .eq('owner_id', agent.id)
      .not('building_type', 'is', null);
    const buildingList = buildings || [];
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

  const terrain = tile?.terrain || 'unknown';
  const warnings: string[] = [];
  if (agent.food < 10) warnings.push('LOW FOOD');
  if (agent.gold >= resourceCap * 0.9) warnings.push('gold near cap');
  if (agent.wood >= resourceCap * 0.9) warnings.push('wood near cap');
  if (agent.stone >= resourceCap * 0.9) warnings.push('stone near cap');

  const summary = [
    `${agent.name}`,
    `(${agent.x},${agent.y}) ${terrain}`,
    `G:${agent.gold} W:${agent.wood} F:${agent.food} S:${agent.stone}`,
    `Wealth:${wealthBreakdown.total}`,
    `Rep:${agent.reputation}`,
    `Cap:${resourceCap}`,
    `${territoryCount} territories`,
    `${pendingTradeCount} trades`,
    warnings.length > 0 ? `⚠ ${warnings.join(', ')}` : '',
  ].filter(Boolean).join(' | ');

  return new Response(summary, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  });
}
