import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateGatheredResources } from '@/lib/game-logic';
import { 
  TerrainType, 
  DEPLETION_CHANCE,
  REGENERATION_MS,
  STAMINA_COST_GATHER,
  GATHER_PENALTY_MULTIPLIER,
  UPGRADE_BONUSES
} from '@/lib/types';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';

// Helper: Check if tile has regenerated (1 hour since depletion)
function hasTileRegenerated(depletedAt: string | null): boolean {
  if (!depletedAt) return true;
  const depletedTime = new Date(depletedAt).getTime();
  const now = Date.now();
  return (now - depletedTime) >= REGENERATION_MS;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting first (per-IP)
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

    // Get dynamic cooldown setting
    const gatherCooldownMs = await getCooldownMs('gather');

    // Atomic cooldown check - prevents race conditions
    const cooldownResult = await atomicCooldownCheck(agent.id, 'gather', gatherCooldownMs);
    
    if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
      const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
      return errorResponse(
        `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
        429
      );
    }
    
    if (!cooldownResult.success) {
      // If atomic check fails, fall back to manual check (in case DB function doesn't exist yet)
      if (agent.last_gather_at) {
        const lastGather = new Date(agent.last_gather_at).getTime();
        const elapsed = Date.now() - lastGather;
        if (elapsed < gatherCooldownMs) {
          const waitSeconds = Math.ceil((gatherCooldownMs - elapsed) / 1000);
          return errorResponse(
            `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
            429
          );
        }
      }
    }

    // Check stamina (food) - determines if we apply penalty
    const hasStamina = agent.food >= STAMINA_COST_GATHER;
    const staminaCost = hasStamina ? STAMINA_COST_GATHER : 0; // Don't deduct if already at 0

    // Get current tile with ownership, depletion, and upgrade info
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id, depleted, depleted_at, upgrade_level')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;
    const isOwnedByAgent = tile.owner_id === agent.id;
    const upgradeLevel = tile.upgrade_level || 1;

    // Markets don't produce resources
    if (terrain === 'market') {
      return jsonResponse({
        success: true,
        data: {
          message: 'Markets are for trading, not gathering. Visit forests, plains, or mountains for resources.',
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
          tile_status: 'market',
          stamina: {
            cost: 0,
            penalty_applied: false,
            food_remaining: agent.food
          }
        },
      });
    }

    // Check if tile is depleted
    const tileRegenerated = hasTileRegenerated(tile.depleted_at);
    
    if (tile.depleted && !tileRegenerated) {
      // Calculate time until regeneration
      const depletedTime = new Date(tile.depleted_at!).getTime();
      const timeUntilRegen = Math.ceil((REGENERATION_MS - (Date.now() - depletedTime)) / 60000);
      
      return jsonResponse({
        success: true,
        data: {
          message: `This ${terrain} tile is depleted. Resources will regenerate in ~${timeUntilRegen} minutes. Move to another tile!`,
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
          tile_status: 'depleted',
          regenerates_in_minutes: timeUntilRegen,
          stamina: {
            cost: 0,
            penalty_applied: false,
            food_remaining: agent.food
          }
        },
      });
    }

    // If tile was depleted but has now regenerated, reset it
    if (tile.depleted && tileRegenerated) {
      await supabase
        .from('tiles')
        .update({ depleted: false, depleted_at: null })
        .eq('x', agent.x)
        .eq('y', agent.y);
    }

    // Water can be gathered from but less efficiently (and doesn't deplete)
    if (terrain === 'water') {
      let waterFood = Math.floor(Math.random() * 2) + 1;
      
      // Apply stamina penalty if no food
      if (!hasStamina) {
        waterFood = Math.floor(waterFood * GATHER_PENALTY_MULTIPLIER);
      }
      
      // Net food change (gathered - stamina cost)
      const netFoodChange = waterFood - staminaCost;
      const newFood = Math.max(0, agent.food + netFoodChange);
      
      // Update agent inventory
      const updateData: Record<string, unknown> = {
        food: newFood,
        total_gathered_food: (agent.total_gathered_food || 0) + waterFood,
      };
      
      // Only set cooldown if atomic check didn't do it
      if (!cooldownResult.success) {
        updateData.last_gather_at = new Date().toISOString();
      }

      await supabase
        .from('agents')
        .update(updateData)
        .eq('id', agent.id);

      // Log event
      await supabase.from('events').insert({
        agent_id: agent.id,
        type: 'gather',
        data: { 
          terrain, 
          resources: { gold: 0, wood: 0, food: waterFood, stone: 0 },
          stamina_cost: staminaCost,
          stamina_penalty: !hasStamina
        },
        location: { x: agent.x, y: agent.y },
      });

      const penaltyText = !hasStamina ? ' (50% penalty - no food stamina!)' : '';

      return jsonResponse({
        success: true,
        data: {
          message: `You fish in the water and catch ${waterFood} food${penaltyText}. Stamina cost: ${staminaCost} food.`,
          gathered: { gold: 0, wood: 0, food: waterFood, stone: 0 },
          terrain,
          tile_status: 'available',
          stamina: {
            cost: staminaCost,
            penalty_applied: !hasStamina,
            food_remaining: newFood
          },
          inventory: {
            gold: agent.gold,
            wood: agent.wood,
            food: newFood,
            stone: agent.stone
          }
        },
      });
    }

    // Calculate resources based on terrain
    let gathered = calculateGatheredResources(terrain);
    
    // Apply territory bonus if agent owns this tile (using upgrade level)
    let bonusMultiplier = 1.0;
    if (isOwnedByAgent) {
      bonusMultiplier = UPGRADE_BONUSES[upgradeLevel] || UPGRADE_BONUSES[1];
      gathered = {
        gold: Math.floor(gathered.gold * bonusMultiplier),
        wood: Math.floor(gathered.wood * bonusMultiplier),
        food: Math.floor(gathered.food * bonusMultiplier),
        stone: Math.floor(gathered.stone * bonusMultiplier),
      };
    }

    // Apply stamina penalty if no food
    if (!hasStamina) {
      gathered = {
        gold: Math.floor(gathered.gold * GATHER_PENALTY_MULTIPLIER),
        wood: Math.floor(gathered.wood * GATHER_PENALTY_MULTIPLIER),
        food: Math.floor(gathered.food * GATHER_PENALTY_MULTIPLIER),
        stone: Math.floor(gathered.stone * GATHER_PENALTY_MULTIPLIER),
      };
    }

    // Roll for depletion (20% chance)
    const tileDepleted = Math.random() < DEPLETION_CHANCE;

    // Update tile depletion status if depleted
    if (tileDepleted) {
      await supabase
        .from('tiles')
        .update({ 
          depleted: true, 
          depleted_at: new Date().toISOString() 
        })
        .eq('x', agent.x)
        .eq('y', agent.y);
    }

    // Calculate new inventory (food includes stamina cost deduction)
    const newGold = agent.gold + gathered.gold;
    const newWood = agent.wood + gathered.wood;
    const newFood = Math.max(0, agent.food + gathered.food - staminaCost);
    const newStone = agent.stone + gathered.stone;

    // Update agent inventory and total gathered stats
    const inventoryUpdate: Record<string, unknown> = {
      gold: newGold,
      wood: newWood,
      food: newFood,
      stone: newStone,
      // Update lifetime gathering stats
      total_gathered_gold: (agent.total_gathered_gold || 0) + gathered.gold,
      total_gathered_wood: (agent.total_gathered_wood || 0) + gathered.wood,
      total_gathered_food: (agent.total_gathered_food || 0) + gathered.food,
      total_gathered_stone: (agent.total_gathered_stone || 0) + gathered.stone,
    };

    // Only set cooldown if atomic check didn't do it
    if (!cooldownResult.success) {
      inventoryUpdate.last_gather_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('agents')
      .update(inventoryUpdate)
      .eq('id', agent.id);

    if (updateError) {
      console.error('Error updating inventory:', updateError);
      return errorResponse('Failed to gather resources', 500);
    }

    // Log gather event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'gather',
      data: { 
        terrain,
        resources: gathered,
        tile_depleted: tileDepleted,
        territory_bonus: isOwnedByAgent,
        upgrade_level: isOwnedByAgent ? upgradeLevel : undefined,
        stamina_cost: staminaCost,
        stamina_penalty: !hasStamina
      },
      location: { x: agent.x, y: agent.y },
    });

    // Format message based on what was gathered
    const gatheredItems = Object.entries(gathered)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(', ');

    const bonusPercent = Math.round((bonusMultiplier - 1) * 100);
    const bonusText = isOwnedByAgent ? ` (with +${bonusPercent}% territory bonus, level ${upgradeLevel})` : '';
    const penaltyText = !hasStamina ? ' [50% PENALTY - no food stamina!]' : '';
    const depletionText = tileDepleted ? ' WARNING: This tile is now DEPLETED and will regenerate in 1 hour.' : '';
    const staminaText = ` Stamina cost: ${staminaCost} food.`;
    
    const message = gatheredItems 
      ? `You gathered ${gatheredItems} from the ${terrain}${bonusText}${penaltyText}.${staminaText}${depletionText}`
      : `You searched the ${terrain} but found nothing this time.${penaltyText}${staminaText}${depletionText}`;

    return jsonResponse({
      success: true,
      data: {
        message,
        gathered,
        terrain,
        territory_bonus: isOwnedByAgent,
        upgrade_level: isOwnedByAgent ? upgradeLevel : undefined,
        tile_depleted: tileDepleted,
        tile_status: tileDepleted ? 'depleted' : 'available',
        stamina: {
          cost: staminaCost,
          penalty_applied: !hasStamina,
          food_remaining: newFood
        },
        inventory: {
          gold: newGold,
          wood: newWood,
          food: newFood,
          stone: newStone,
        },
      },
    });
  } catch (error) {
    console.error('Gather error:', error);
    return errorResponse('Internal server error', 500);
  }
}
