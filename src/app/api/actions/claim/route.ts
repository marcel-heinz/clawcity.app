import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  CLAIM_COST_GOLD,
  CLAIM_COST_WOOD,
  CLAIM_COST_STONE,
  CLAIM_COST_FOOD,
  STAMINA_COST_CLAIM,
  MAX_TERRITORIES_PER_AGENT,
  TerrainType,
  TERRITORY_UPKEEP_FOOD,
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { getItemDefinition } from '@/lib/crafting';
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
  scopeAgentMutation,
  scopeTileQuery,
  scopeWorldQuery,
} from '@/lib/game-context';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter}s.`, 429);
  }

  const auth = await authenticateAgent(request);

  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const supabase = createServerClient();
    const context = await resolveGameplayContext(auth.agent.id);
    const agent = await resolveAgentForContext(auth.agent, context);

    const agentsTable = gameplayTableName('agents', context);
    const tilesTable = gameplayTableName('tiles', context);
    const eventsTable = gameplayTableName('events', context);
    const itemsTable = gameplayTableName('agent_items', context);

    const addWorld = <T extends Record<string, unknown>>(payload: T): T | (T & { world_id: string }) => {
      if (context.mode === 'open_world' && context.world_id) {
        return { world_id: context.world_id, ...payload };
      }
      return payload;
    };

    // Check for Territory Deed (claim_discount effect)
    let hasTerrityDeed = false;
    let deedDiscountPercent = 0;
    let deedItemRow: { id: string; uses_remaining: number | null } | null = null;

    let deedQuery = supabase
      .from(itemsTable)
      .select('id, uses_remaining')
      .eq('agent_id', agent.id)
      .eq('item_id', 'territory_deed');
    deedQuery = scopeWorldQuery(deedQuery, context);

    const { data: deedItem } = await deedQuery.maybeSingle();

    if (deedItem && (deedItem.uses_remaining === null || deedItem.uses_remaining > 0)) {
      const deedDef = getItemDefinition('territory_deed');
      if (deedDef) {
        for (const effect of deedDef.effects) {
          if (effect.type === 'claim_discount') {
            hasTerrityDeed = true;
            deedDiscountPercent = effect.percent;
            deedItemRow = deedItem;
          }
        }
      }
    }

    // Apply discount if deed is active
    const discountMultiplier = hasTerrityDeed ? (100 - deedDiscountPercent) / 100 : 1;
    const effectiveGoldCost = Math.floor(CLAIM_COST_GOLD * discountMultiplier);
    const effectiveWoodCost = Math.floor(CLAIM_COST_WOOD * discountMultiplier);
    const effectiveStoneCost = Math.floor(CLAIM_COST_STONE * discountMultiplier);
    const effectiveFoodClaimCost = Math.floor(CLAIM_COST_FOOD * discountMultiplier);

    // Calculate total food cost (claiming cost + stamina cost - stamina is never discounted)
    const totalFoodCost = effectiveFoodClaimCost + STAMINA_COST_CLAIM;

    // Check if agent has enough resources for ALL costs
    const missingResources: string[] = [];

    if (agent.gold < effectiveGoldCost) {
      missingResources.push(`gold (need ${effectiveGoldCost}, have ${agent.gold})`);
    }
    if (agent.wood < effectiveWoodCost) {
      missingResources.push(`wood (need ${effectiveWoodCost}, have ${agent.wood})`);
    }
    if (agent.stone < effectiveStoneCost) {
      missingResources.push(`stone (need ${effectiveStoneCost}, have ${agent.stone})`);
    }
    if (agent.food < totalFoodCost) {
      missingResources.push(`food (need ${totalFoodCost} [${effectiveFoodClaimCost} claim + ${STAMINA_COST_CLAIM} stamina], have ${agent.food})`);
    }

    if (missingResources.length > 0) {
      const deedNote = hasTerrityDeed ? ' (with Territory Deed -50% discount)' : '';
      return errorResponse(
        `Not enough resources to claim territory. Missing: ${missingResources.join(', ')}. ` +
          `Full cost: ${effectiveGoldCost} gold, ${effectiveWoodCost} wood, ${effectiveStoneCost} stone, ${totalFoodCost} food${deedNote}.`,
        400
      );
    }

    // Get current tile
    let tileQuery = supabase.from(tilesTable).select('terrain, owner_id');
    tileQuery = scopeTileQuery(tileQuery, context, agent.x, agent.y);

    const { data: tile, error: tileError } = await tileQuery.single();

    if (tileError || !tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;

    // Cannot claim markets or water
    if (terrain === 'market') {
      return errorResponse('Markets cannot be claimed - they belong to everyone.', 400);
    }

    if (terrain === 'water') {
      return errorResponse('Water tiles cannot be claimed.', 400);
    }

    // Check if tile is already owned
    if (tile.owner_id) {
      if (tile.owner_id === agent.id) {
        return errorResponse('You already own this tile!', 400);
      }

      // Get owner name for better error message
      const { data: owner } = await supabase.from('agents').select('name').eq('id', tile.owner_id).single();

      return errorResponse(
        `This tile is already claimed by ${owner?.name || 'another agent'}. Trade with them to acquire it.`,
        400
      );
    }

    // Count agent's current territories
    let territoryCountQuery = supabase
      .from(tilesTable)
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);
    territoryCountQuery = scopeWorldQuery(territoryCountQuery, context);
    const { count: territoryCount } = await territoryCountQuery;

    if ((territoryCount || 0) >= MAX_TERRITORIES_PER_AGENT) {
      return errorResponse(
        `You have reached the maximum of ${MAX_TERRITORIES_PER_AGENT} territories. Trade or release tiles to claim more.`,
        400
      );
    }

    // Calculate new resource amounts
    const newGold = agent.gold - effectiveGoldCost;
    const newWood = agent.wood - effectiveWoodCost;
    const newStone = agent.stone - effectiveStoneCost;
    const newFood = agent.food - totalFoodCost;

    // Deduct all resources from agent atomically
    let resourceUpdateQuery = supabase.from(agentsTable).update({
      gold: newGold,
      wood: newWood,
      stone: newStone,
      food: newFood,
    });
    resourceUpdateQuery = scopeAgentMutation(resourceUpdateQuery, context, agent.id);

    const { error: resourceError } = await resourceUpdateQuery;

    if (resourceError) {
      console.error('Error deducting resources:', resourceError);
      return errorResponse('Failed to process claim payment', 500);
    }

    // Claim the tile
    const claimTimestamp = new Date().toISOString();
    let claimTileQuery = supabase
      .from(tilesTable)
      .update({
        owner_id: agent.id,
        claimed_at: claimTimestamp,
      });
    claimTileQuery = scopeTileQuery(claimTileQuery, context, agent.x, agent.y);

    const { error: claimError } = await claimTileQuery;

    if (claimError) {
      console.error('Error claiming tile:', claimError);
      // Refund all resources if claim failed
      let refundQuery = supabase.from(agentsTable).update({
        gold: agent.gold,
        wood: agent.wood,
        stone: agent.stone,
        food: agent.food,
      });
      refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
      await refundQuery;
      return errorResponse('Failed to claim tile', 500);
    }

    // Consume Territory Deed if used
    if (hasTerrityDeed && deedItemRow) {
      let consumeQuery = supabase
        .from(itemsTable)
        .update({ uses_remaining: 0, quantity: 0 })
        .eq('id', deedItemRow.id);
      consumeQuery = scopeWorldQuery(consumeQuery, context);
      await consumeQuery;
    }

    // Log claim event
    await supabase.from(eventsTable).insert(
      addWorld({
        agent_id: agent.id,
        type: 'claim',
        data: {
          terrain,
          cost: {
            gold: effectiveGoldCost,
            wood: effectiveWoodCost,
            stone: effectiveStoneCost,
            food: totalFoodCost,
          },
          territory_deed_used: hasTerrityDeed,
          territory_count: (territoryCount || 0) + 1,
          upkeep_cost_per_hour: TERRITORY_UPKEEP_FOOD,
        },
        location: { x: agent.x, y: agent.y },
      })
    );

    const newTerritoryCount = (territoryCount || 0) + 1;
    const deedMessage = hasTerrityDeed ? ' (Territory Deed applied: -50% cost!)' : '';

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message:
        `You have claimed this ${terrain} tile!${deedMessage} ` +
        `Cost: ${effectiveGoldCost} gold, ${effectiveWoodCost} wood, ${effectiveStoneCost} stone, ${totalFoodCost} food. ` +
        `You now receive +25% resources when gathering here (upgradeable to +75%). ` +
        `IMPORTANT: Territory upkeep is ${TERRITORY_UPKEEP_FOOD} food/territory/hour (${newTerritoryCount * TERRITORY_UPKEEP_FOOD} food/hour total for your ${newTerritoryCount} territories).`,
      position: { x: agent.x, y: agent.y },
      terrain,
      cost: {
        gold: effectiveGoldCost,
        wood: effectiveWoodCost,
        stone: effectiveStoneCost,
        food: totalFoodCost,
        territory_deed_used: hasTerrityDeed,
        food_breakdown: {
          claim_cost: effectiveFoodClaimCost,
          stamina_cost: STAMINA_COST_CLAIM,
        },
      },
      upkeep: {
        food_per_territory_per_hour: TERRITORY_UPKEEP_FOOD,
        total_food_per_hour: newTerritoryCount * TERRITORY_UPKEEP_FOOD,
      },
      inventory: {
        gold: newGold,
        wood: newWood,
        stone: newStone,
        food: newFood,
      },
      territory_count: newTerritoryCount,
      max_territories: MAX_TERRITORIES_PER_AGENT,
      context,
    });

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
