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
  TERRITORY_UPKEEP_FOOD
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { getItemDefinition } from '@/lib/crafting';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429
    );
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();
    const deedDef = getItemDefinition('territory_deed');
    let deedDiscountPercent = 50;
    if (deedDef) {
      for (const effect of deedDef.effects) {
        if (effect.type === 'claim_discount') {
          deedDiscountPercent = effect.percent;
          break;
        }
      }
    }

    const { data: rawResult, error: claimError } = await supabase.rpc('claim_tile_atomic', {
      p_agent_id: agent.id,
      p_x: agent.x,
      p_y: agent.y,
      p_base_gold_cost: CLAIM_COST_GOLD,
      p_base_wood_cost: CLAIM_COST_WOOD,
      p_base_stone_cost: CLAIM_COST_STONE,
      p_base_food_claim_cost: CLAIM_COST_FOOD,
      p_food_stamina_cost: STAMINA_COST_CLAIM,
      p_max_territories: MAX_TERRITORIES_PER_AGENT,
      p_territory_upkeep_food: TERRITORY_UPKEEP_FOOD,
      p_deed_discount_percent: deedDiscountPercent,
    });

    if (claimError) {
      console.error('Atomic claim RPC error:', claimError);
      return errorResponse('Failed to claim tile', 500);
    }

    const result = (rawResult || {}) as Record<string, unknown>;
    const code = typeof result.code === 'string' ? result.code : 'unknown';
    const toNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    if (result.ok !== true) {
      if (code === 'market_tile') {
        return errorResponse('Markets cannot be claimed - they belong to everyone.', 400);
      }
      if (code === 'water_tile') {
        return errorResponse('Water tiles cannot be claimed.', 400);
      }
      if (code === 'already_owned') {
        return errorResponse('You already own this tile!', 400);
      }
      if (code === 'tile_claimed') {
        const ownerId = typeof result.owner_id === 'string' ? result.owner_id : null;
        let ownerName = 'another agent';
        if (ownerId) {
          const { data: owner } = await supabase
            .from('agents')
            .select('name')
            .eq('id', ownerId)
            .single();
          if (owner?.name) ownerName = owner.name;
        }
        return errorResponse(
          `This tile is already claimed by ${ownerName}. Trade with them to acquire it.`,
          400
        );
      }
      if (code === 'territory_limit') {
        return errorResponse(
          `You have reached the maximum of ${MAX_TERRITORIES_PER_AGENT} territories. Trade or release tiles to claim more.`,
          400
        );
      }
      if (code === 'insufficient_resources') {
        const cost = (result.cost && typeof result.cost === 'object')
          ? result.cost as Record<string, unknown>
          : {};
        const missingResources = Array.isArray(result.missing_resources)
          ? result.missing_resources.filter((v): v is string => typeof v === 'string')
          : [];
        const effectiveGoldCost = toNumber(cost.gold, CLAIM_COST_GOLD);
        const effectiveWoodCost = toNumber(cost.wood, CLAIM_COST_WOOD);
        const effectiveStoneCost = toNumber(cost.stone, CLAIM_COST_STONE);
        const totalFoodCost = toNumber(cost.food, CLAIM_COST_FOOD + STAMINA_COST_CLAIM);
        const deedNote = result.territory_deed_used === true
          ? ` (with Territory Deed -${deedDiscountPercent}% discount)`
          : '';
        return errorResponse(
          `Not enough resources to claim territory. Missing: ${missingResources.join(', ')}. ` +
          `Full cost: ${effectiveGoldCost} gold, ${effectiveWoodCost} wood, ${effectiveStoneCost} stone, ${totalFoodCost} food${deedNote}.`,
          400
        );
      }
      if (code === 'tile_not_found') {
        return errorResponse('Could not find your current tile', 500);
      }
      return errorResponse('Failed to claim tile', 500);
    }

    const terrain = typeof result.terrain === 'string' ? result.terrain : 'unknown';
    const newTerritoryCount = toNumber(result.territory_count, 0);
    const cost = (result.cost && typeof result.cost === 'object')
      ? result.cost as Record<string, unknown>
      : {};
    const inventory = (result.inventory && typeof result.inventory === 'object')
      ? result.inventory as Record<string, unknown>
      : {};

    const effectiveGoldCost = toNumber(cost.gold, CLAIM_COST_GOLD);
    const effectiveWoodCost = toNumber(cost.wood, CLAIM_COST_WOOD);
    const effectiveStoneCost = toNumber(cost.stone, CLAIM_COST_STONE);
    const effectiveFoodClaimCost = toNumber(cost.food_claim_cost, CLAIM_COST_FOOD);
    const totalFoodCost = toNumber(cost.food, effectiveFoodClaimCost + STAMINA_COST_CLAIM);

    const newGold = toNumber(inventory.gold, agent.gold - effectiveGoldCost);
    const newWood = toNumber(inventory.wood, agent.wood - effectiveWoodCost);
    const newStone = toNumber(inventory.stone, agent.stone - effectiveStoneCost);
    const newFood = toNumber(inventory.food, agent.food - totalFoodCost);

    const territoryDeedUsed = result.territory_deed_used === true;
    const deedMessage = territoryDeedUsed
      ? ` (Territory Deed applied: -${deedDiscountPercent}% cost!)`
      : '';

    const responseData = await withAnnouncements(agent, {
      message: `You have claimed this ${terrain} tile!${deedMessage} ` +
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
        territory_deed_used: territoryDeedUsed,
        food_breakdown: {
          claim_cost: effectiveFoodClaimCost,
          stamina_cost: STAMINA_COST_CLAIM
        }
      },
      upkeep: {
        food_per_territory_per_hour: TERRITORY_UPKEEP_FOOD,
        total_food_per_hour: newTerritoryCount * TERRITORY_UPKEEP_FOOD
      },
      inventory: {
        gold: newGold,
        wood: newWood,
        stone: newStone,
        food: newFood
      },
      territory_count: newTerritoryCount,
      max_territories: MAX_TERRITORIES_PER_AGENT,
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
