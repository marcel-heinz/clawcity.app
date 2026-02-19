import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import {
  SHOP_ITEMS,
  MAX_TOTAL_ITEMS,
  getItemDefinition,
  type ValidItemId,
} from '@/lib/crafting';
import { calculateResourceCap } from '@/lib/buildings';
import { parseBuyRequestBody } from '@/lib/buy-request';

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
    const agent = auth.agent;
    const supabase = createServerClient();
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return errorResponse(
        'Invalid JSON body. Expected {"item_id":"rations","quantity":1}.',
        400,
      );
    }

    const parsedRequest = parseBuyRequestBody(rawBody);
    const itemId = parsedRequest.itemId;
    const quantity = parsedRequest.quantity;

    if (!itemId) {
      return errorResponse(
        `Missing required field: item_id. Valid shop items: ${SHOP_ITEMS.join(', ')}.`,
        400,
      );
    }

    const getResourceCap = async (): Promise<number> => {
      let storageCount = 0;
      try {
        const { data: storageRows } = await supabase
          .from('tiles')
          .select('building_type')
          .eq('owner_id', agent.id)
          .eq('building_type', 'storage');
        storageCount = storageRows?.length || 0;
      } catch {
        // building columns may not exist yet
      }
      return calculateResourceCap(storageCount);
    };

    // Validate item ID
    if (!SHOP_ITEMS.includes(itemId as ValidItemId)) {
      return errorResponse(
        `Invalid item_id "${itemId}". Valid shop items: ${SHOP_ITEMS.join(', ')}`,
        400
      );
    }

    const itemDef = getItemDefinition(itemId)!;

    if (!itemDef.shop_price) {
      return errorResponse('This item is not available in the shop. Try crafting it.', 400);
    }

    const totalCost = itemDef.shop_price * quantity;

    // Check if agent has enough gold
    if (agent.gold < totalCost) {
      return errorResponse(
        `Not enough gold to buy ${quantity}x ${itemDef.name}. ` +
        `Cost: ${totalCost} gold (${itemDef.shop_price} each). You have: ${agent.gold} gold.`,
        400
      );
    }

    // Check if agent already has max quantity of this item
    const { data: existingItem } = await supabase
      .from('agent_items')
      .select('id, quantity, uses_remaining')
      .eq('agent_id', agent.id)
      .eq('item_id', itemId)
      .single();

    const currentQty = existingItem ? existingItem.quantity : 0;
    // For consumed items (uses_remaining = 0), treat as 0 quantity
    const effectiveQty = (itemDef.max_uses !== null && existingItem?.uses_remaining !== null && existingItem?.uses_remaining <= 0)
      ? 0 : currentQty;

    if (effectiveQty + quantity > itemDef.max_quantity) {
      return errorResponse(
        `Cannot buy ${quantity}x ${itemDef.name}. ` +
        `You have ${effectiveQty}/${itemDef.max_quantity}. Max quantity: ${itemDef.max_quantity}.`,
        400
      );
    }

    // Check total item count
    const { data: allItems } = await supabase
      .from('agent_items')
      .select('quantity, uses_remaining, item_id')
      .eq('agent_id', agent.id);

    const totalItems = (allItems || []).reduce((sum: number, item: { quantity: number; uses_remaining: number | null; item_id: string }) => {
      const def = getItemDefinition(item.item_id);
      if (def?.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) return sum;
      return sum + item.quantity;
    }, 0);

    if (totalItems + quantity > MAX_TOTAL_ITEMS) {
      return errorResponse(
        `Inventory full. You have ${totalItems}/${MAX_TOTAL_ITEMS} items.`,
        400
      );
    }

    // Deduct gold
    const newGold = agent.gold - totalCost;

    const { error: goldError } = await supabase
      .from('agents')
      .update({ gold: newGold })
      .eq('id', agent.id);

    if (goldError) {
      console.error('Error deducting gold for purchase:', goldError);
      return errorResponse('Failed to process purchase', 500);
    }

    // Add or update item in inventory
    if (existingItem) {
      if (itemDef.max_uses !== null && existingItem.uses_remaining !== null && existingItem.uses_remaining <= 0) {
        // Replace consumed item
        const { error: updateError } = await supabase
          .from('agent_items')
          .update({
            quantity: quantity,
            uses_remaining: itemDef.max_uses,
            created_at: new Date().toISOString(),
          })
          .eq('id', existingItem.id);

        if (updateError) {
          await supabase.from('agents').update({ gold: agent.gold }).eq('id', agent.id);
          return errorResponse('Failed to add item to inventory', 500);
        }
      } else {
        const { error: updateError } = await supabase
          .from('agent_items')
          .update({ quantity: effectiveQty + quantity })
          .eq('id', existingItem.id);

        if (updateError) {
          await supabase.from('agents').update({ gold: agent.gold }).eq('id', agent.id);
          return errorResponse('Failed to add item to inventory', 500);
        }
      }
    } else {
      const { error: insertError } = await supabase
        .from('agent_items')
        .insert({
          agent_id: agent.id,
          item_id: itemId,
          quantity: quantity,
          uses_remaining: itemDef.max_uses,
        });

      if (insertError) {
        await supabase.from('agents').update({ gold: agent.gold }).eq('id', agent.id);
        console.error('Error inserting purchased item:', insertError);
        return errorResponse('Failed to add item to inventory', 500);
      }
    }

    // Handle instant effects
    let instantMessage = '';
    let updatedFood = agent.food;
    const resourceCap = await getResourceCap();

    for (const effect of itemDef.effects) {
      if (effect.type === 'instant_food') {
        const requestedFoodGain = effect.amount * quantity;
        const nextFood =
          updatedFood >= resourceCap
            ? updatedFood
            : Math.min(resourceCap, updatedFood + requestedFoodGain);
        const appliedFoodGain = Math.max(0, nextFood - updatedFood);
        updatedFood = nextFood;

        await supabase
          .from('agents')
          .update({ food: updatedFood })
          .eq('id', agent.id);

        // Consume the items
        await supabase
          .from('agent_items')
          .update({ uses_remaining: 0, quantity: 0 })
          .eq('agent_id', agent.id)
          .eq('item_id', itemId);

        instantMessage = appliedFoodGain > 0
          ? ` Restored ${appliedFoodGain} food!`
          : ` Food already at cap (${resourceCap}).`;
      }
    }

    // Log buy event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'buy',
      data: {
        item_id: itemId,
        item_name: itemDef.name,
        quantity,
        total_cost: totalCost,
        category: itemDef.category,
      },
      location: { x: agent.x, y: agent.y },
    });

    const responseData = await withAnnouncements(agent, {
      message: `Bought ${quantity}x ${itemDef.name} for ${totalCost} gold.${instantMessage}`,
      item: {
        id: itemId,
        name: itemDef.name,
        category: itemDef.category,
        quantity,
        price_per_unit: itemDef.shop_price,
        total_cost: totalCost,
        uses: itemDef.max_uses,
      },
      inventory: {
        gold: newGold,
        wood: agent.wood,
        food: instantMessage ? updatedFood : agent.food,
        stone: agent.stone,
      },
      ...(parsedRequest.usedLegacyItemField
        ? {
            warning:
              'Legacy field "item" was accepted for compatibility. Prefer "item_id".',
          }
        : {}),
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Buy error:', error);
    return errorResponse('Internal server error', 500);
  }
}
