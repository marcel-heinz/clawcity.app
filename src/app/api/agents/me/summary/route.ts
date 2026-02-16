import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateResourceCap } from '@/lib/buildings';
import { calculateWealthBreakdown } from '@/lib/types';
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
  scopeTileQuery,
  scopeWorldQuery,
} from '@/lib/game-context';

/**
 * GET /api/agents/me/summary
 *
 * Returns a pre-formatted one-line text summary of agent stats.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const context = await resolveGameplayContext(auth.agent.id);
  const agent = await resolveAgentForContext(auth.agent, context);
  const supabase = createServerClient();

  const tilesTable = gameplayTableName('tiles', context);
  const tradesTable = gameplayTableName('trades', context);

  // Get current tile terrain
  let tileQuery = supabase.from(tilesTable).select('terrain');
  tileQuery = scopeTileQuery(tileQuery, context, agent.x, agent.y);
  const { data: tile } = await tileQuery.single();

  // Count buildings and storage
  let storageCount = 0;
  let workshopCount = 0;
  let fortificationCount = 0;
  try {
    let buildingQuery = supabase
      .from(tilesTable)
      .select('building_type')
      .eq('owner_id', agent.id)
      .not('building_type', 'is', null);
    buildingQuery = scopeWorldQuery(buildingQuery, context);

    const { data: buildings } = await buildingQuery;
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
    let territoryQuery = supabase
      .from(tilesTable)
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);
    territoryQuery = scopeWorldQuery(territoryQuery, context);

    const { count } = await territoryQuery;
    territoryCount = count || 0;
  } catch {
    // tiles table may not have owner_id yet
  }

  // Count pending trades
  let pendingTradeCount = 0;
  try {
    let tradeQuery = supabase
      .from(tradesTable)
      .select('*', { count: 'exact', head: true })
      .eq('to_agent_id', agent.id)
      .eq('status', 'pending');
    tradeQuery = scopeWorldQuery(tradeQuery, context);

    const { count } = await tradeQuery;
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

  const modeText = context.mode === 'open_world'
    ? `open_world:${context.world_name || context.world_id || 'unknown'}`
    : 'tournament';

  const summary = [
    `${agent.name}`,
    `[${modeText}]`,
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
