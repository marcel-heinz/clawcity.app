import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import {
  CRAFTABLE_ITEMS,
  CRAFT_COOLDOWN_MS,
  MAX_TOTAL_ITEMS,
  getItemDefinition,
  hasResourcesForRecipe,
  formatRecipeCost,
  type ValidItemId,
} from '@/lib/crafting';
import { agentHasWorkshop, calculateResourceCap } from '@/lib/buildings';
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
  scopeAgentMutation,
  scopeWorldQuery,
} from '@/lib/game-context';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Rate limiting
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
    const body = await request.json();
    const itemId = body.item_id as string;
    const context = await resolveGameplayContext(auth.agent.id);
    const agent = await resolveAgentForContext(auth.agent, context);
    const agentsTable = gameplayTableName('agents', context);
    const tilesTable = gameplayTableName('tiles', context);
    const itemsTable = gameplayTableName('agent_items', context);
    const eventsTable = gameplayTableName('events', context);

    const addWorld = <T extends Record<string, unknown>>(payload: T): T | (T & { world_id: string }) => {
      if (context.mode === 'open_world' && context.world_id) {
        return { world_id: context.world_id, ...payload };
      }
      return payload;
    };

    const getResourceCap = async (): Promise<number> => {
      let storageCount = 0;
      try {
        let storageQuery = supabase
          .from(tilesTable)
          .select('building_type')
          .eq('owner_id', agent.id)
          .eq('building_type', 'storage');
        storageQuery = scopeWorldQuery(storageQuery, context);
        const { data: storageRows } = await storageQuery;
        storageCount = storageRows?.length || 0;
      } catch {
        // building columns may not exist yet
      }
      return calculateResourceCap(storageCount);
    };

    // Validate item ID
    if (!itemId || !CRAFTABLE_ITEMS.includes(itemId as ValidItemId)) {
      return errorResponse(
        `Invalid item_id. Craftable items: ${CRAFTABLE_ITEMS.join(', ')}`,
        400
      );
    }

    const itemDef = getItemDefinition(itemId)!;

    // Check crafting cooldown
    if (agent.last_craft_at) {
      const lastCraft = new Date(agent.last_craft_at as string).getTime();
      const elapsed = Date.now() - lastCraft;
      if (elapsed < CRAFT_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((CRAFT_COOLDOWN_MS - elapsed) / 1000);
        return errorResponse(
          `Crafting cooldown active. Wait ${waitSeconds}s before crafting again.`,
          429
        );
      }
    }

    // Check recipe exists
    if (!itemDef.recipe) {
      return errorResponse('This item cannot be crafted. Try buying it from the shop.', 400);
    }

    // Check if item requires Workshop
    if (itemDef.requires_workshop) {
      let hasWorkshop = false;
      try {
        let buildingsQuery = supabase
          .from(tilesTable)
          .select('building_type')
          .eq('owner_id', agent.id)
          .not('building_type', 'is', null);
        buildingsQuery = scopeWorldQuery(buildingsQuery, context);
        const { data: buildings } = await buildingsQuery;
        hasWorkshop = agentHasWorkshop((buildings || []) as { building_type: string }[]);
      } catch {
        // building columns may not exist yet
      }
      if (!hasWorkshop) {
        return errorResponse(
          `${itemDef.name} requires a Workshop building. Build one on your territory first.`,
          400
        );
      }
    }

    // Check resources
    const { hasEnough, missing } = hasResourcesForRecipe(agent, itemDef.recipe);
    if (!hasEnough) {
      return errorResponse(
        `Not enough resources to craft ${itemDef.name}. Missing: ${missing.join(', ')}. ` +
        `Recipe: ${formatRecipeCost(itemDef.recipe)}.`,
        400
      );
    }

    // Check if agent already has max quantity of this item
    let existingItemQuery = supabase
      .from(itemsTable)
      .select('id, quantity, uses_remaining')
      .eq('agent_id', agent.id)
      .eq('item_id', itemId);
    existingItemQuery = scopeWorldQuery(existingItemQuery, context);
    const { data: existingItem } = await existingItemQuery.single();

    if (existingItem) {
      // For tools with uses, check if the existing one is consumed
      if (itemDef.max_uses !== null && existingItem.uses_remaining !== null && existingItem.uses_remaining <= 0) {
        // Item is consumed, allow re-crafting by replacing it
      } else if (existingItem.quantity >= itemDef.max_quantity) {
        return errorResponse(
          `You already have the maximum quantity of ${itemDef.name} (${itemDef.max_quantity}).`,
          400
        );
      }
    }

    // Check total item count
    let allItemsQuery = supabase
      .from(itemsTable)
      .select('quantity, uses_remaining, item_id')
      .eq('agent_id', agent.id);
    allItemsQuery = scopeWorldQuery(allItemsQuery, context);
    const { data: allItems } = await allItemsQuery;

    const totalItems = (allItems || []).reduce((sum: number, item: { quantity: number; uses_remaining: number | null; item_id: string }) => {
      // Don't count consumed items
      const def = getItemDefinition(item.item_id);
      if (def?.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) return sum;
      return sum + item.quantity;
    }, 0);

    if (totalItems >= MAX_TOTAL_ITEMS) {
      return errorResponse(
        `Inventory full. You have ${totalItems}/${MAX_TOTAL_ITEMS} items. Use or discard items first.`,
        400
      );
    }

    // Deduct resources
    const newGold = agent.gold - (itemDef.recipe.gold || 0);
    const newWood = agent.wood - (itemDef.recipe.wood || 0);
    const newFood = agent.food - (itemDef.recipe.food || 0);
    const newStone = agent.stone - (itemDef.recipe.stone || 0);

    let resourceUpdateQuery = supabase
      .from(agentsTable)
      .update({
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
        last_craft_at: new Date().toISOString(),
      });
    resourceUpdateQuery = scopeAgentMutation(resourceUpdateQuery, context, agent.id);
    const { error: resourceError } = await resourceUpdateQuery;

    if (resourceError) {
      console.error('Error deducting resources for craft:', resourceError);
      return errorResponse('Failed to process crafting payment', 500);
    }

    // Add or update item in inventory
    if (existingItem) {
      if (itemDef.max_uses !== null && existingItem.uses_remaining !== null && existingItem.uses_remaining <= 0) {
        // Replace consumed item
        const { error: updateError } = await supabase
          .from(itemsTable)
          .update({
            uses_remaining: itemDef.max_uses,
            quantity: 1,
            created_at: new Date().toISOString(),
          })
          .eq('id', existingItem.id);

        if (updateError) {
          // Refund resources
          let refundQuery = supabase.from(agentsTable).update({
            gold: agent.gold, wood: agent.wood, food: agent.food, stone: agent.stone,
          });
          refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
          await refundQuery;
          console.error('Error updating item:', updateError);
          return errorResponse('Failed to craft item', 500);
        }
      } else {
        // Increment quantity (for consumables)
        const { error: updateError } = await supabase
          .from(itemsTable)
          .update({ quantity: existingItem.quantity + 1 })
          .eq('id', existingItem.id);

        if (updateError) {
          let refundQuery = supabase.from(agentsTable).update({
            gold: agent.gold, wood: agent.wood, food: agent.food, stone: agent.stone,
          });
          refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
          await refundQuery;
          console.error('Error updating item:', updateError);
          return errorResponse('Failed to craft item', 500);
        }
      }
    } else {
      // Insert new item
      const insertPayload: Record<string, unknown> = {
        agent_id: agent.id,
        item_id: itemId,
        quantity: 1,
        uses_remaining: itemDef.max_uses,
      };
      if (context.mode === 'open_world' && context.world_id) {
        insertPayload.world_id = context.world_id;
      }
      const { error: insertError } = await supabase
        .from(itemsTable)
        .insert(insertPayload);

      if (insertError) {
        let refundQuery = supabase.from(agentsTable).update({
          gold: agent.gold, wood: agent.wood, food: agent.food, stone: agent.stone,
        });
        refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
        await refundQuery;
        console.error('Error inserting item:', insertError);
        return errorResponse('Failed to craft item', 500);
      }
    }

    // Apply instant effects for consumables that are used on craft
    let instantMessage = '';
    let finalFood = newFood;
    if (itemDef.category === 'consumable') {
      const resourceCap = await getResourceCap();
      for (const effect of itemDef.effects) {
        if (effect.type === 'instant_food') {
          // Auto-use provisions on craft
          const requestedFoodGain = effect.amount;
          const updatedFood =
            finalFood >= resourceCap
              ? finalFood
              : Math.min(resourceCap, finalFood + requestedFoodGain);
          const appliedFoodGain = Math.max(0, updatedFood - finalFood);
          finalFood = updatedFood;

          let foodUpdateQuery = supabase
            .from(agentsTable)
            .update({ food: updatedFood });
          foodUpdateQuery = scopeAgentMutation(foodUpdateQuery, context, agent.id);
          await foodUpdateQuery;

          // Consume the item
          if (existingItem) {
            const newQty = existingItem.quantity; // didn't increment for instant use
            let consumeQuery = supabase
              .from(itemsTable)
              .update({
                quantity: Math.max(0, newQty),
                uses_remaining: 0,
              })
              .eq('agent_id', agent.id)
              .eq('item_id', itemId);
            consumeQuery = scopeWorldQuery(consumeQuery, context);
            await consumeQuery;
          } else {
            let consumeQuery = supabase
              .from(itemsTable)
              .update({ uses_remaining: 0, quantity: 0 })
              .eq('agent_id', agent.id)
              .eq('item_id', itemId);
            consumeQuery = scopeWorldQuery(consumeQuery, context);
            await consumeQuery;
          }

          instantMessage = appliedFoodGain > 0
            ? ` Restored ${appliedFoodGain} food!`
            : ` Food already at cap (${resourceCap}).`;
        }
      }
    }

    // Log craft event
    await supabase.from(eventsTable).insert(
      addWorld({
        agent_id: agent.id,
        type: 'craft',
        data: {
          item_id: itemId,
          item_name: itemDef.name,
          category: itemDef.category,
          recipe: itemDef.recipe,
        },
        location: { x: agent.x, y: agent.y },
      })
    );

    // Build response
    const effectDescriptions = itemDef.effects.map(e => {
      switch (e.type) {
        case 'gather_bonus':
          const bonus = Math.round((e.multiplier - 1) * 100);
          const terrain = e.terrains === 'all' ? 'all terrains' : e.terrains.join(', ');
          return `+${bonus}% gathering on ${terrain}`;
        case 'cooldown_reduction':
          return `-${e.percent}% ${e.action} cooldown`;
        case 'detection_range':
          return `${e.range}-tile detection range`;
        case 'upkeep_reduction':
          return `-${e.percent}% territory upkeep`;
        case 'instant_food':
          return `+${e.amount} food`;
        default:
          return '';
      }
    }).filter(Boolean);

    const responseData = await withAnnouncements(agent, {
      message: `Crafted ${itemDef.name}! Cost: ${formatRecipeCost(itemDef.recipe)}.${instantMessage}` +
        (itemDef.max_uses !== null ? ` (${itemDef.max_uses} uses)` : ''),
      item: {
        id: itemId,
        name: itemDef.name,
        category: itemDef.category,
        effects: effectDescriptions,
        uses: itemDef.max_uses,
      },
      inventory: {
        gold: newGold,
        wood: newWood,
        food: finalFood,
        stone: newStone,
      },
      context,
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Craft error:', error);
    return errorResponse('Internal server error', 500);
  }
}
