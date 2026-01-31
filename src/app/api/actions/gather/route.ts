import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateGatheredResources, checkCooldown } from '@/lib/game-logic';
import { 
  TerrainType, 
  TERRITORY_BONUS_MULTIPLIER, 
  GATHER_COOLDOWN_MS,
  DEPLETION_CHANCE,
  REGENERATION_MS,
  TERRITORY_UPKEEP_GOLD,
  UPKEEP_PERIOD_MS
} from '@/lib/types';

// Helper: Check if tile has regenerated (1 hour since depletion)
function hasTileRegenerated(depletedAt: string | null): boolean {
  if (!depletedAt) return true;
  const depletedTime = new Date(depletedAt).getTime();
  const now = Date.now();
  return (now - depletedTime) >= REGENERATION_MS;
}

// Helper: Process territory upkeep for an agent
async function processUpkeep(
  supabase: ReturnType<typeof createServerClient>,
  agentId: string,
  currentGold: number
): Promise<{ goldDeducted: number; territoriesLost: number; newGold: number }> {
  let goldDeducted = 0;
  let territoriesLost = 0;
  let newGold = currentGold;

  // Get all tiles owned by this agent
  const { data: ownedTiles } = await supabase
    .from('tiles')
    .select('x, y, last_upkeep_paid, claimed_at')
    .eq('owner_id', agentId);

  if (!ownedTiles || ownedTiles.length === 0) {
    return { goldDeducted: 0, territoriesLost: 0, newGold: currentGold };
  }

  const now = Date.now();

  for (const tile of ownedTiles) {
    const lastPaid = tile.last_upkeep_paid 
      ? new Date(tile.last_upkeep_paid).getTime() 
      : tile.claimed_at 
        ? new Date(tile.claimed_at).getTime()
        : now;
    
    const msSinceLastPaid = now - lastPaid;
    const daysOverdue = Math.floor(msSinceLastPaid / UPKEEP_PERIOD_MS);

    if (daysOverdue >= 1) {
      const upkeepDue = daysOverdue * TERRITORY_UPKEEP_GOLD;

      if (newGold >= upkeepDue) {
        // Pay upkeep
        newGold -= upkeepDue;
        goldDeducted += upkeepDue;

        await supabase
          .from('tiles')
          .update({ last_upkeep_paid: new Date().toISOString() })
          .eq('x', tile.x)
          .eq('y', tile.y);
      } else {
        // Can't afford - release territory
        await supabase
          .from('tiles')
          .update({ 
            owner_id: null, 
            claimed_at: null, 
            last_upkeep_paid: null 
          })
          .eq('x', tile.x)
          .eq('y', tile.y);

        territoriesLost++;
      }
    }
  }

  // Update agent's gold if any was deducted
  if (goldDeducted > 0) {
    await supabase
      .from('agents')
      .update({ gold: newGold })
      .eq('id', agentId);
  }

  return { goldDeducted, territoriesLost, newGold };
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();

    // Check gather cooldown
    const cooldown = checkCooldown(agent.last_gather_at, GATHER_COOLDOWN_MS);
    if (!cooldown.allowed) {
      const waitSeconds = Math.ceil(cooldown.remainingMs / 1000);
      return errorResponse(
        `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
        429
      );
    }

    // Process territory upkeep before gathering
    const upkeepResult = await processUpkeep(supabase, agent.id, agent.gold);
    let currentGold = upkeepResult.newGold;

    // Get current tile with ownership and depletion info
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id, depleted, depleted_at')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;
    const isOwnedByAgent = tile.owner_id === agent.id;

    // Markets don't produce resources
    if (terrain === 'market') {
      return jsonResponse({
        success: true,
        data: {
          message: 'Markets are for trading, not gathering. Visit forests, plains, or mountains for resources.',
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
          tile_status: 'market',
          upkeep: upkeepResult.goldDeducted > 0 ? {
            gold_deducted: upkeepResult.goldDeducted,
            territories_lost: upkeepResult.territoriesLost,
          } : undefined,
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
          upkeep: upkeepResult.goldDeducted > 0 ? {
            gold_deducted: upkeepResult.goldDeducted,
            territories_lost: upkeepResult.territoriesLost,
          } : undefined,
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
      const waterFood = Math.floor(Math.random() * 2) + 1;
      
      // Update agent inventory
      await supabase
        .from('agents')
        .update({
          gold: currentGold,
          food: agent.food + waterFood,
          last_gather_at: new Date().toISOString(),
          total_gathered_food: (agent.total_gathered_food || 0) + waterFood,
        })
        .eq('id', agent.id);

      // Log event
      await supabase.from('events').insert({
        agent_id: agent.id,
        type: 'gather',
        data: { terrain, resources: { gold: 0, wood: 0, food: waterFood, stone: 0 } },
        location: { x: agent.x, y: agent.y },
      });

      return jsonResponse({
        success: true,
        data: {
          message: 'You fish in the water and catch some food.',
          gathered: { gold: 0, wood: 0, food: waterFood, stone: 0 },
          terrain,
          tile_status: 'available',
          upkeep: upkeepResult.goldDeducted > 0 ? {
            gold_deducted: upkeepResult.goldDeducted,
            territories_lost: upkeepResult.territoriesLost,
          } : undefined,
        },
      });
    }

    // Calculate resources based on terrain
    let gathered = calculateGatheredResources(terrain);
    
    // Apply territory bonus if agent owns this tile
    if (isOwnedByAgent) {
      gathered = {
        gold: Math.floor(gathered.gold * TERRITORY_BONUS_MULTIPLIER),
        wood: Math.floor(gathered.wood * TERRITORY_BONUS_MULTIPLIER),
        food: Math.floor(gathered.food * TERRITORY_BONUS_MULTIPLIER),
        stone: Math.floor(gathered.stone * TERRITORY_BONUS_MULTIPLIER),
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

    // Update agent inventory, cooldown, and total gathered stats
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        gold: currentGold + gathered.gold,
        wood: agent.wood + gathered.wood,
        food: agent.food + gathered.food,
        stone: agent.stone + gathered.stone,
        last_gather_at: new Date().toISOString(),
        // Update lifetime gathering stats
        total_gathered_gold: (agent.total_gathered_gold || 0) + gathered.gold,
        total_gathered_wood: (agent.total_gathered_wood || 0) + gathered.wood,
        total_gathered_food: (agent.total_gathered_food || 0) + gathered.food,
        total_gathered_stone: (agent.total_gathered_stone || 0) + gathered.stone,
      })
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
      },
      location: { x: agent.x, y: agent.y },
    });

    // Format message based on what was gathered
    const gatheredItems = Object.entries(gathered)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(', ');

    const bonusText = isOwnedByAgent ? ' (with +25% territory bonus!)' : '';
    const depletionText = tileDepleted ? ' WARNING: This tile is now DEPLETED and will regenerate in 1 hour.' : '';
    const message = gatheredItems 
      ? `You gathered ${gatheredItems} from the ${terrain}${bonusText}.${depletionText}`
      : `You searched the ${terrain} but found nothing this time.${depletionText}`;

    return jsonResponse({
      success: true,
      data: {
        message,
        gathered,
        terrain,
        territory_bonus: isOwnedByAgent,
        tile_depleted: tileDepleted,
        tile_status: tileDepleted ? 'depleted' : 'available',
        inventory: {
          gold: currentGold + gathered.gold,
          wood: agent.wood + gathered.wood,
          food: agent.food + gathered.food,
          stone: agent.stone + gathered.stone,
        },
        upkeep: upkeepResult.goldDeducted > 0 || upkeepResult.territoriesLost > 0 ? {
          gold_deducted: upkeepResult.goldDeducted,
          territories_lost: upkeepResult.territoriesLost,
        } : undefined,
      },
    });
  } catch (error) {
    console.error('Gather error:', error);
    return errorResponse('Internal server error', 500);
  }
}
