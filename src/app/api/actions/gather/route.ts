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
import { buildGatherCooldownMeta, buildGatherTileIntel } from '@/lib/gather-intel';
import { consumeDurableAxeUse, getActiveStorageBonus } from '@/lib/claw-credits';

interface GatherTileSnapshot {
  terrain: TerrainType;
  depleted?: boolean | null;
  depleted_at?: string | null;
  regenerates_at?: string | null;
  gather_count?: number | null;
}

async function getGatherTileCooldownContext(
  supabase: ReturnType<typeof createServerClient>,
  position: { x: number; y: number },
): Promise<{ terrain: TerrainType; tile_intel: ReturnType<typeof buildGatherTileIntel> } | null> {
  const { data: tile, error } = await supabase
    .from('tiles')
    .select('terrain, depleted, depleted_at, regenerates_at, gather_count')
    .eq('x', position.x)
    .eq('y', position.y)
    .maybeSingle();

  if (error || !tile) return null;

  const tileSnapshot = tile as GatherTileSnapshot;
  const nonDepleting = tileSnapshot.terrain === 'water' || tileSnapshot.terrain === 'market';
  const harvestable = isTileHarvestable(tileSnapshot);
  return {
    terrain: tileSnapshot.terrain,
    tile_intel: buildGatherTileIntel(Math.max(0, tileSnapshot.gather_count || 0), {
      nonDepleting,
      depleted: !nonDepleting && !harvestable,
    }),
  };
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503, {
      code: 'database_not_configured',
    });
  }

  // Apply rate limiting first (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429,
      {
        code: 'rate_limited',
        retry_after_seconds: retryAfter,
      }
    );
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401, {
      code: 'unauthorized',
    });
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
    const fullCooldownMeta = (cooldownApplied = true) =>
      buildGatherCooldownMeta(gatherCooldownMs, cooldownApplied ? gatherCooldownMs : 0);

    // Atomic cooldown check - prevents race conditions
    const cooldownResult = await atomicCooldownCheck(agent.id, 'gather', gatherCooldownMs);
    
    if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
      const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
      const tileCooldownContext = await getGatherTileCooldownContext(supabase, { x: agent.x, y: agent.y });
      return jsonResponse(
        {
          success: false,
          code: 'gather_cooldown',
          error: `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
          cooldown: buildGatherCooldownMeta(gatherCooldownMs, cooldownResult.remainingMs),
          ...(tileCooldownContext || {}),
        },
        429,
      );
    }
    
    if (!cooldownResult.success) {
      // If atomic check fails, fall back to manual check (in case DB function doesn't exist yet)
      if (agent.last_gather_at) {
        const lastGather = new Date(agent.last_gather_at).getTime();
        const elapsed = Date.now() - lastGather;
        if (elapsed < gatherCooldownMs) {
          const remainingMs = Math.max(0, gatherCooldownMs - elapsed);
          const waitSeconds = Math.ceil(remainingMs / 1000);
          const tileCooldownContext = await getGatherTileCooldownContext(supabase, { x: agent.x, y: agent.y });
          return jsonResponse(
            {
              success: false,
              code: 'gather_cooldown',
              error: `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
              cooldown: buildGatherCooldownMeta(gatherCooldownMs, remainingMs),
              ...(tileCooldownContext || {}),
            },
            429,
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
      return errorResponse('Could not find your current tile', 500, {
        code: 'tile_not_found',
      });
    }

    const terrain = tile.terrain as TerrainType;
    const isOwnedByAgent = tile.owner_id === agent.id;
    const upgradeLevel = tile.upgrade_level || 1;
    const tileMarkedDepleted = Boolean(tile.depleted || tile.regenerates_at || tile.depleted_at);
    const tileHarvestable = isTileHarvestable({
      depleted: tile.depleted,
      depleted_at: tile.depleted_at,
      regenerates_at: tile.regenerates_at,
    });

    let baseGatherCount = Math.max(0, tile.gather_count || 0);

    // If tile was depleted but has now regenerated, reset depletion markers before this gather.
    if (tileMarkedDepleted && tileHarvestable) {
      await supabase
        .from('tiles')
        .update({
          depleted: false,
          depleted_at: null,
          regenerates_at: null,
          gather_count: 0,
        })
        .eq('x', agent.x)
        .eq('y', agent.y);
      baseGatherCount = 0;
    }

    const baseTileIntel = (opts: { depleted?: boolean; nonDepleting?: boolean } = {}) =>
      buildGatherTileIntel(baseGatherCount, opts);

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
          cooldown: fullCooldownMeta(cooldownResult.success),
          tile_intel: baseTileIntel({
            depleted: tileMarkedDepleted && !tileHarvestable,
          }),
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
          cooldown: fullCooldownMeta(cooldownResult.success),
          tile_intel: baseTileIntel({ nonDepleting: true }),
          inventory: currentInventory,
        },
      });
    }

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
          cooldown: fullCooldownMeta(cooldownResult.success),
          tile_intel: baseTileIntel({ depleted: true }),
          inventory: currentInventory,
        },
      });
    }

    // Get current gather count for this tile (for progressive depletion)
    const currentGatherCount = baseGatherCount + 1;

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
            cooldown: fullCooldownMeta(cooldownResult.success),
            tile_intel: buildGatherTileIntel(currentGatherCount, { nonDepleting: true }),
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

      const torchUpdateData: Record<string, unknown> = {
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
        last_gather_x: agent.x,
        last_gather_y: agent.y,
        consecutive_same_tile: consecutiveGathers,
      };
      if (!cooldownResult.success) {
        torchUpdateData.last_gather_at = new Date().toISOString();
      }

      await supabase
        .from('agents')
        .update(torchUpdateData)
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
          cooldown: fullCooldownMeta(),
          tile_intel: buildGatherTileIntel(currentGatherCount, { nonDepleting: true }),
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
          cooldown: fullCooldownMeta(),
          tile_intel: buildGatherTileIntel(currentGatherCount, { nonDepleting: true }),
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

    // Durable Axe perk: same gather class as lumber axe (+30% on forest), but
    // tracked as tournament perk uses instead of inventory item uses.
    let durableAxeApplied = false;
    let durableAxeUsesRemaining = 0;
    const durableAxeMultiplier = 1.3;
    if (terrain === 'forest') {
      const durableAxeResult = await consumeDurableAxeUse(supabase, agent.id);
      if (durableAxeResult.applied) {
        durableAxeApplied = true;
        durableAxeUsesRemaining = durableAxeResult.usesRemaining;
        gathered = {
          gold: Math.floor(gathered.gold * durableAxeMultiplier),
          wood: Math.floor(gathered.wood * durableAxeMultiplier),
          food: Math.floor(gathered.food * durableAxeMultiplier),
          stone: Math.floor(gathered.stone * durableAxeMultiplier),
        };
      }
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
    const storageBonusCap = await getActiveStorageBonus(supabase, agent.id);
    const resourceCap = calculateResourceCap(storageCount) + storageBonusCap;

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
      return errorResponse('Failed to gather resources', 500, {
        code: 'gather_update_failed',
        details: {
          terrain,
          tile_intel: buildGatherTileIntel(currentGatherCount, { depleted: tileDepleted }),
        },
      });
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
        durable_axe_bonus: durableAxeApplied ? {
          multiplier: durableAxeMultiplier,
          uses_remaining: durableAxeUsesRemaining,
        } : null,
      },
      location: { x: agent.x, y: agent.y },
    });

    const tileIntel = buildGatherTileIntel(currentGatherCount, { depleted: tileDepleted });

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
    const durableAxeText = durableAxeApplied
      ? ` [PERK: Durable Axe +30% (${durableAxeUsesRemaining} uses left)]`
      : '';

    // Build penalty/efficiency text
    const efficiencyParts: string[] = [];
    if (efficiencyPercent < 100) efficiencyParts.push(`${efficiencyPercent}% efficiency from low food`);
    if (consecutiveGathers > 1) efficiencyParts.push(`${Math.round(sameTileMultiplier * 100)}% from same-tile (gather #${consecutiveGathers})`);
    const penaltyText = efficiencyParts.length > 0 ? ` [${efficiencyParts.join(', ')}]` : '';

    // Give actionable depletion pressure without exposing exact regeneration timers.
    const depletionText = tileDepleted
      ? ' The land grows barren... time to explore elsewhere!'
      : tileIntel.tile_health === 'fragile' || tileIntel.tile_health === 'critical'
        ? ` Warning: tile health is ${tileIntel.tile_health}; move soon for steadier yield.`
        : '';
    const staminaText = ` Stamina cost: ${staminaCost} food.`;

    const message = gatheredItems
      ? `You gathered ${gatheredItems} from the ${terrain}${bonusText}${eventText}${itemText}${durableAxeText}${penaltyText}.${staminaText}${depletionText}`
      : `You searched the ${terrain} but found nothing this time.${eventText}${itemText}${durableAxeText}${penaltyText}${staminaText}${depletionText}`;

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message,
      gathered,
      terrain,
      territory_bonus: isOwnedByAgent,
      upgrade_level: isOwnedByAgent ? upgradeLevel : undefined,
      tile_depleted: tileDepleted,
      tile_status: tileDepleted ? 'depleted' : 'available',
      cooldown: fullCooldownMeta(),
      tile_intel: tileIntel,
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
      durable_axe_bonus: durableAxeApplied ? {
        multiplier: durableAxeMultiplier,
        bonus_percent: 30,
        uses_remaining: durableAxeUsesRemaining,
      } : null,
      resource_cap_breakdown: {
        base: calculateResourceCap(storageCount),
        claw_credit_storage_bonus: storageBonusCap,
        total: resourceCap,
      },
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
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
