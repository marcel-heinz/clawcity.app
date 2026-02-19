import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateGatheredResources } from '@/lib/game-logic';
import {
  TerrainType,
  STAMINA_COST_GATHER,
  UPGRADE_BONUSES,
  // New anti-exploit functions
  getTileRegenTime,
  getDepletionChance,
  getFoodEfficiencyMultiplier,
  getSameTilePenalty,
} from '@/lib/types';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { getActiveEventBonus, applyEventBonusToResources } from '@/lib/micro-events';
import {
  calculateItemGatherBonus,
  canGatherWithItems,
  getGatherItemsToUse,
  type AgentItem,
} from '@/lib/crafting';
import { calculateResourceCap } from '@/lib/buildings';
import { isTileHarvestable } from '@/lib/tile-state';

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
    const currentInventory = {
      gold: agent.gold,
      wood: agent.wood,
      food: agent.food,
      stone: agent.stone,
    };

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

    // Check stamina (food) - determines efficiency multiplier
    const hasStamina = agent.food >= STAMINA_COST_GATHER;
    const staminaCost = hasStamina ? STAMINA_COST_GATHER : 0; // Don't deduct if already at 0

    // Calculate progressive food efficiency (gradual curve instead of binary)
    const foodEfficiency = getFoodEfficiencyMultiplier(agent.food);
    const efficiencyPercent = Math.round(foodEfficiency * 100);

    // Check if gathering from same tile (for diminishing returns)
    const isSameTile = agent.last_gather_x === agent.x && agent.last_gather_y === agent.y;
    const consecutiveGathers = isSameTile ? (agent.consecutive_same_tile || 0) + 1 : 1;
    const sameTileMultiplier = getSameTilePenalty(consecutiveGathers);

    // Get current tile with ownership, depletion, upgrade, and building info
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id, depleted, depleted_at, regenerates_at, gather_count, upgrade_level, building_type')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;
    const isOwnedByAgent = tile.owner_id === agent.id;
    const upgradeLevel = tile.upgrade_level || 1;

    // Building exclusivity: other agents can't gather on tiles with buildings
    if (tile.building_type && !isOwnedByAgent) {
      return jsonResponse({
        success: true,
        data: {
          message: `This tile has a ${tile.building_type} owned by another agent. You cannot gather here.`,
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
          tile_status: 'building_blocked',
          stamina: { cost: 0, penalty_applied: false, food_remaining: agent.food },
          inventory: currentInventory,
        },
      });
    }

    // Fetch agent's items for bonus calculations
    let agentItems: AgentItem[] = [];
    try {
      const { data: items } = await supabase
        .from('agent_items')
        .select('id, agent_id, item_id, quantity, uses_remaining, created_at, expires_at')
        .eq('agent_id', agent.id)
        .gt('quantity', 0);
      agentItems = ((items || []) as AgentItem[]).filter((item: AgentItem) =>
        item.uses_remaining === null || item.uses_remaining > 0
      );
    } catch {
      // If agent_items table doesn't exist yet, continue without items
    }

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
          },
          inventory: currentInventory,
        },
      });
    }

    const tileMarkedDepleted = Boolean(tile.depleted || tile.regenerates_at || tile.depleted_at);
    const tileHarvestable = isTileHarvestable({
      depleted: tile.depleted,
      depleted_at: tile.depleted_at,
      regenerates_at: tile.regenerates_at,
    });

    if (tileMarkedDepleted && !tileHarvestable) {
      // Don't reveal exact regeneration time - this prevents timer exploits
      return jsonResponse({
        success: true,
        data: {
          message: `This ${terrain} tile appears barren. The land needs time to recover. Try exploring nearby tiles!`,
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
          tile_status: 'depleted',
          // Removed: regenerates_in_minutes (anti-exploit: hide exact timing)
          stamina: {
            cost: 0,
            penalty_applied: false,
            food_remaining: agent.food
          },
          inventory: currentInventory,
        },
      });
    }

    // If tile was depleted but has now regenerated, reset it
    if (tileMarkedDepleted && tileHarvestable) {
      await supabase
        .from('tiles')
        .update({
          depleted: false,
          depleted_at: null,
          regenerates_at: null,
          gather_count: 0  // Reset gather count on regeneration
        })
        .eq('x', agent.x)
        .eq('y', agent.y);
    }

    // Get current gather count for this tile (for progressive depletion)
    const currentGatherCount = (tile.gather_count || 0) + 1;

    // Check if terrain normally has no resources but items enable gathering
    const barrenTerrains: TerrainType[] = ['rocky', 'sand'];
    if (barrenTerrains.includes(terrain)) {
      if (!canGatherWithItems(agentItems, terrain)) {
        return jsonResponse({
          success: true,
          data: {
            message: `This ${terrain} terrain has no resources. A Torch would let you gather here.`,
            gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
            terrain,
            tile_status: 'barren',
            stamina: { cost: 0, penalty_applied: false, food_remaining: agent.food },
            inventory: currentInventory,
          },
        });
      }
      // With torch: yield small resources
      const torchYield = {
        gold: 0,
        wood: terrain === 'rocky' ? 0 : Math.floor(Math.random() * 2),
        food: 0,
        stone: terrain === 'rocky' ? Math.floor(Math.random() * 2) + 1 : 0,
      };

      // Decrement uses for items used
      const torchItems = getGatherItemsToUse(agentItems, terrain);
      for (const item of agentItems) {
        if (torchItems.some(u => u.itemId === item.item_id) && item.uses_remaining !== null) {
          await supabase
            .from('agent_items')
            .update({ uses_remaining: Math.max(0, item.uses_remaining - 1) })
            .eq('agent_id', agent.id)
            .eq('item_id', item.item_id);
        }
      }

      const netFoodChange = -staminaCost;
      const newFood = Math.max(0, agent.food + netFoodChange);
      const newGold = agent.gold + torchYield.gold;
      const newWood = agent.wood + torchYield.wood;
      const newStone = agent.stone + torchYield.stone;

      await supabase
        .from('agents')
        .update({
          gold: newGold, wood: newWood, food: newFood, stone: newStone,
          last_gather_x: agent.x, last_gather_y: agent.y,
          consecutive_same_tile: consecutiveGathers,
        })
        .eq('id', agent.id);

      const yieldText = Object.entries(torchYield)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ') || 'nothing';

      return jsonResponse({
        success: true,
        data: {
          message: `Using your Torch, you scavenge ${yieldText} from the ${terrain}. Stamina cost: ${staminaCost} food.`,
          gathered: torchYield,
          terrain,
          tile_status: 'available',
          items_used: torchItems.map(t => t.itemName),
          stamina: { cost: staminaCost, efficiency: efficiencyPercent, food_remaining: newFood },
          inventory: { gold: newGold, wood: newWood, food: newFood, stone: newStone },
        },
      });
    }

    // Water can be gathered from but less efficiently (and doesn't deplete)
    if (terrain === 'water') {
      let waterFood = Math.floor(Math.random() * 2) + 1;

      // Apply item bonuses for water gathering
      const waterItemMultiplier = calculateItemGatherBonus(agentItems, terrain);
      waterFood = Math.floor(waterFood * waterItemMultiplier);

      // Apply progressive food efficiency and same-tile penalty
      const combinedMultiplier = foodEfficiency * sameTileMultiplier;
      waterFood = Math.floor(waterFood * combinedMultiplier);

      // Decrement tool uses for water gathering items
      const waterItemsUsed = getGatherItemsToUse(agentItems, terrain);
      for (const item of agentItems) {
        if (waterItemsUsed.some(u => u.itemId === item.item_id) && item.uses_remaining !== null) {
          await supabase
            .from('agent_items')
            .update({ uses_remaining: Math.max(0, item.uses_remaining - 1) })
            .eq('agent_id', agent.id)
            .eq('item_id', item.item_id);
        }
      }

      // Net food change (gathered - stamina cost)
      const netFoodChange = waterFood - staminaCost;
      const newFood = Math.max(0, agent.food + netFoodChange);

      // Update agent inventory and same-tile tracking
      const updateData: Record<string, unknown> = {
        food: newFood,
        total_gathered_food: (agent.total_gathered_food || 0) + waterFood,
        last_gather_x: agent.x,
        last_gather_y: agent.y,
        consecutive_same_tile: consecutiveGathers,
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
          food_efficiency: efficiencyPercent,
          same_tile_penalty: consecutiveGathers > 1,
          consecutive_gathers: consecutiveGathers
        },
        location: { x: agent.x, y: agent.y },
      });

      // Build penalty text
      const penaltyParts: string[] = [];
      if (efficiencyPercent < 100) penaltyParts.push(`${efficiencyPercent}% efficiency from low food`);
      if (consecutiveGathers > 1) penaltyParts.push(`${Math.round(sameTileMultiplier * 100)}% from same-tile penalty`);
      const penaltyText = penaltyParts.length > 0 ? ` (${penaltyParts.join(', ')})` : '';

      return jsonResponse({
        success: true,
        data: {
          message: `You fish in the water and catch ${waterFood} food${penaltyText}. Stamina cost: ${staminaCost} food.`,
          gathered: { gold: 0, wood: 0, food: waterFood, stone: 0 },
          terrain,
          tile_status: 'available',
          stamina: {
            cost: staminaCost,
            efficiency: efficiencyPercent,
            food_remaining: newFood
          },
          same_tile: {
            consecutive_gathers: consecutiveGathers,
            penalty_multiplier: sameTileMultiplier
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

    // Apply micro-event bonus if there's an active event affecting this tile
    const { multiplier: eventMultiplier, event: activeEvent } = await getActiveEventBonus(agent.x, agent.y, terrain);
    if (activeEvent) {
      gathered = applyEventBonusToResources(gathered, activeEvent);
    }

    // Apply item bonuses (tools, backpack, etc.)
    const itemBonusMultiplier = calculateItemGatherBonus(agentItems, terrain);
    if (itemBonusMultiplier > 1.0) {
      gathered = {
        gold: Math.floor(gathered.gold * itemBonusMultiplier),
        wood: Math.floor(gathered.wood * itemBonusMultiplier),
        food: Math.floor(gathered.food * itemBonusMultiplier),
        stone: Math.floor(gathered.stone * itemBonusMultiplier),
      };
    }

    // Decrement tool uses for items that applied bonuses
    const gatherItemsUsed = getGatherItemsToUse(agentItems, terrain);
    for (const item of agentItems) {
      if (gatherItemsUsed.some(u => u.itemId === item.item_id) && item.uses_remaining !== null) {
        await supabase
          .from('agent_items')
          .update({ uses_remaining: Math.max(0, item.uses_remaining - 1) })
          .eq('agent_id', agent.id)
          .eq('item_id', item.item_id);
      }
    }

    // Apply progressive food efficiency AND same-tile penalty
    const combinedMultiplier = foodEfficiency * sameTileMultiplier;
    gathered = {
      gold: Math.floor(gathered.gold * combinedMultiplier),
      wood: Math.floor(gathered.wood * combinedMultiplier),
      food: Math.floor(gathered.food * combinedMultiplier),
      stone: Math.floor(gathered.stone * combinedMultiplier),
    };

    // Calculate progressive depletion chance (1 safe gather, then escalating)
    const depletionChance = getDepletionChance(currentGatherCount);
    const tileDepleted = Math.random() < depletionChance;

    // Update tile - always update gather_count, set depletion if depleted
    if (tileDepleted) {
      // Calculate variable regeneration time based on terrain
      const regenTimeMs = getTileRegenTime(terrain);
      const regeneratesAt = new Date(Date.now() + regenTimeMs).toISOString();

      await supabase
        .from('tiles')
        .update({
          depleted: true,
          depleted_at: new Date().toISOString(),
          regenerates_at: regeneratesAt,
          gather_count: currentGatherCount
        })
        .eq('x', agent.x)
        .eq('y', agent.y);
    } else {
      // Just update gather count (for progressive depletion tracking)
      await supabase
        .from('tiles')
        .update({ gather_count: currentGatherCount })
        .eq('x', agent.x)
        .eq('y', agent.y);
    }

    // Enforce resource cap
    let storageCount = 0;
    try {
      const { data: storageTiles } = await supabase
        .from('tiles')
        .select('building_type')
        .eq('owner_id', agent.id)
        .eq('building_type', 'storage');
      storageCount = storageTiles?.length || 0;
    } catch {
      // If building columns don't exist yet, continue without cap
    }
    const resourceCap = calculateResourceCap(storageCount);

    // Apply resource cap: can't gather above cap (excess is lost)
    gathered = {
      gold: Math.max(0, Math.min(gathered.gold, resourceCap - agent.gold)),
      wood: Math.max(0, Math.min(gathered.wood, resourceCap - agent.wood)),
      food: Math.max(0, Math.min(gathered.food, resourceCap - agent.food)),
      stone: Math.max(0, Math.min(gathered.stone, resourceCap - agent.stone)),
    };

    // Calculate new inventory (food includes stamina cost deduction)
    const newGold = agent.gold + gathered.gold;
    const newWood = agent.wood + gathered.wood;
    const newFood = Math.max(0, agent.food + gathered.food - staminaCost);
    const newStone = agent.stone + gathered.stone;

    // Update agent inventory, gathering stats, and same-tile tracking
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
      // Update same-tile tracking
      last_gather_x: agent.x,
      last_gather_y: agent.y,
      consecutive_same_tile: consecutiveGathers,
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
        food_efficiency: efficiencyPercent,
        same_tile_penalty: consecutiveGathers > 1,
        consecutive_gathers: consecutiveGathers,
        tile_gather_count: currentGatherCount,
        depletion_chance: Math.round(depletionChance * 100),
        // Micro-event bonus info
        event_bonus: activeEvent ? {
          event_id: activeEvent.id,
          event_title: activeEvent.title,
          event_type: activeEvent.type,
          multiplier: eventMultiplier,
        } : null,
        // Item bonus info
        item_bonus: gatherItemsUsed.length > 0 ? {
          multiplier: itemBonusMultiplier,
          items_used: gatherItemsUsed.map(i => i.itemName),
        } : null,
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

    // Build event bonus text
    const eventBonusPercent = activeEvent ? Math.round((eventMultiplier - 1) * 100) : 0;
    const eventText = activeEvent
      ? eventBonusPercent >= 0
        ? ` [EVENT: ${activeEvent.title} +${eventBonusPercent}%]`
        : ` [EVENT: ${activeEvent.title} ${eventBonusPercent}%]`
      : '';

    // Build item bonus text
    const itemBonusPercent = itemBonusMultiplier > 1.0 ? Math.round((itemBonusMultiplier - 1) * 100) : 0;
    const itemText = gatherItemsUsed.length > 0
      ? ` [ITEMS: ${gatherItemsUsed.map(i => i.itemName).join(', ')} +${itemBonusPercent}%]`
      : '';

    // Build penalty/efficiency text
    const efficiencyParts: string[] = [];
    if (efficiencyPercent < 100) efficiencyParts.push(`${efficiencyPercent}% efficiency from low food`);
    if (consecutiveGathers > 1) efficiencyParts.push(`${Math.round(sameTileMultiplier * 100)}% from same-tile (gather #${consecutiveGathers})`);
    const penaltyText = efficiencyParts.length > 0 ? ` [${efficiencyParts.join(', ')}]` : '';

    // Don't reveal exact depletion mechanics - vague warning encourages exploration
    const depletionText = tileDepleted ? ' The land grows barren... time to explore elsewhere!' : '';
    const staminaText = ` Stamina cost: ${staminaCost} food.`;

    const message = gatheredItems
      ? `You gathered ${gatheredItems} from the ${terrain}${bonusText}${eventText}${itemText}${penaltyText}.${staminaText}${depletionText}`
      : `You searched the ${terrain} but found nothing this time.${eventText}${itemText}${penaltyText}${staminaText}${depletionText}`;

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message,
      gathered,
      terrain,
      territory_bonus: isOwnedByAgent,
      upgrade_level: isOwnedByAgent ? upgradeLevel : undefined,
      tile_depleted: tileDepleted,
      tile_status: tileDepleted ? 'depleted' : 'available',
      stamina: {
        cost: staminaCost,
        efficiency: efficiencyPercent,
        food_remaining: newFood
      },
      same_tile: {
        consecutive_gathers: consecutiveGathers,
        penalty_multiplier: sameTileMultiplier
      },
      // Micro-event bonus info
      event_bonus: activeEvent ? {
        event_id: activeEvent.id,
        event_title: activeEvent.title,
        event_type: activeEvent.type,
        multiplier: eventMultiplier,
        bonus_percent: eventBonusPercent,
      } : null,
      // Item bonus info
      item_bonus: gatherItemsUsed.length > 0 ? {
        multiplier: itemBonusMultiplier,
        bonus_percent: itemBonusPercent,
        items_used: gatherItemsUsed.map(i => ({ id: i.itemId, name: i.itemName })),
      } : null,
      inventory: {
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
      },
    });

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Gather error:', error);
    return errorResponse('Internal server error', 500);
  }
}
