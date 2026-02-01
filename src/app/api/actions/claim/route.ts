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
  TERRITORY_UPKEEP_FOOD
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';

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

    // Calculate total food cost (claiming cost + stamina cost)
    const totalFoodCost = CLAIM_COST_FOOD + STAMINA_COST_CLAIM;

    // Check if agent has enough resources for ALL costs
    const missingResources: string[] = [];
    
    if (agent.gold < CLAIM_COST_GOLD) {
      missingResources.push(`gold (need ${CLAIM_COST_GOLD}, have ${agent.gold})`);
    }
    if (agent.wood < CLAIM_COST_WOOD) {
      missingResources.push(`wood (need ${CLAIM_COST_WOOD}, have ${agent.wood})`);
    }
    if (agent.stone < CLAIM_COST_STONE) {
      missingResources.push(`stone (need ${CLAIM_COST_STONE}, have ${agent.stone})`);
    }
    if (agent.food < totalFoodCost) {
      missingResources.push(`food (need ${totalFoodCost} [${CLAIM_COST_FOOD} claim + ${STAMINA_COST_CLAIM} stamina], have ${agent.food})`);
    }

    if (missingResources.length > 0) {
      return errorResponse(
        `Not enough resources to claim territory. Missing: ${missingResources.join(', ')}. ` +
        `Full cost: ${CLAIM_COST_GOLD} gold, ${CLAIM_COST_WOOD} wood, ${CLAIM_COST_STONE} stone, ${totalFoodCost} food.`,
        400
      );
    }

    // Get current tile
    const { data: tile, error: tileError } = await supabase
      .from('tiles')
      .select('terrain, owner_id')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

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
      const { data: owner } = await supabase
        .from('agents')
        .select('name')
        .eq('id', tile.owner_id)
        .single();
      
      return errorResponse(
        `This tile is already claimed by ${owner?.name || 'another agent'}. Trade with them to acquire it.`,
        400
      );
    }

    // Count agent's current territories
    const { count: territoryCount } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);

    if ((territoryCount || 0) >= MAX_TERRITORIES_PER_AGENT) {
      return errorResponse(
        `You have reached the maximum of ${MAX_TERRITORIES_PER_AGENT} territories. Trade or release tiles to claim more.`,
        400
      );
    }

    // Calculate new resource amounts
    const newGold = agent.gold - CLAIM_COST_GOLD;
    const newWood = agent.wood - CLAIM_COST_WOOD;
    const newStone = agent.stone - CLAIM_COST_STONE;
    const newFood = agent.food - totalFoodCost;

    // Deduct all resources from agent atomically
    const { error: resourceError } = await supabase
      .from('agents')
      .update({ 
        gold: newGold,
        wood: newWood,
        stone: newStone,
        food: newFood
      })
      .eq('id', agent.id);

    if (resourceError) {
      console.error('Error deducting resources:', resourceError);
      return errorResponse('Failed to process claim payment', 500);
    }

    // Claim the tile
    const claimTimestamp = new Date().toISOString();
    const { error: claimError } = await supabase
      .from('tiles')
      .update({ 
        owner_id: agent.id,
        claimed_at: claimTimestamp
      })
      .eq('x', agent.x)
      .eq('y', agent.y);

    if (claimError) {
      console.error('Error claiming tile:', claimError);
      // Refund all resources if claim failed
      await supabase
        .from('agents')
        .update({ 
          gold: agent.gold,
          wood: agent.wood,
          stone: agent.stone,
          food: agent.food
        })
        .eq('id', agent.id);
      return errorResponse('Failed to claim tile', 500);
    }

    // Log claim event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'claim',
      data: { 
        terrain,
        cost: {
          gold: CLAIM_COST_GOLD,
          wood: CLAIM_COST_WOOD,
          stone: CLAIM_COST_STONE,
          food: totalFoodCost
        },
        territory_count: (territoryCount || 0) + 1,
        upkeep_cost_per_hour: TERRITORY_UPKEEP_FOOD,
      },
      location: { x: agent.x, y: agent.y },
    });

    const newTerritoryCount = (territoryCount || 0) + 1;

    return jsonResponse({
      success: true,
      data: {
        message: `You have claimed this ${terrain} tile! ` +
          `Cost: ${CLAIM_COST_GOLD} gold, ${CLAIM_COST_WOOD} wood, ${CLAIM_COST_STONE} stone, ${totalFoodCost} food. ` +
          `You now receive +25% resources when gathering here (upgradeable to +75%). ` +
          `IMPORTANT: Territory upkeep is ${TERRITORY_UPKEEP_FOOD} food/territory/hour (${newTerritoryCount * TERRITORY_UPKEEP_FOOD} food/hour total for your ${newTerritoryCount} territories).`,
        position: { x: agent.x, y: agent.y },
        terrain,
        cost: {
          gold: CLAIM_COST_GOLD,
          wood: CLAIM_COST_WOOD,
          stone: CLAIM_COST_STONE,
          food: totalFoodCost,
          food_breakdown: {
            claim_cost: CLAIM_COST_FOOD,
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
      },
    });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
