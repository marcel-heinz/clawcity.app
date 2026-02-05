import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/auth';
import {
  CRAFTABLE_ITEMS,
  SHOP_ITEMS,
  getItemDefinition,
  type ItemDefinition,
} from '@/lib/crafting';

function describeEffects(item: ItemDefinition): string[] {
  return item.effects.map(e => {
    switch (e.type) {
      case 'gather_bonus': {
        const bonus = Math.round((e.multiplier - 1) * 100);
        const terrain = e.terrains === 'all' ? 'all terrains' : e.terrains.join(', ');
        return `+${bonus}% gathering on ${terrain}`;
      }
      case 'cooldown_reduction':
        return `-${e.percent}% ${e.action} cooldown`;
      case 'detection_range':
        return `${e.range}-tile detection range`;
      case 'upkeep_reduction':
        return `-${e.percent}% territory upkeep`;
      case 'instant_food':
        return `+${e.amount} food`;
      case 'claim_discount':
        return `-${e.percent}% territory claim cost`;
      case 'terrain_gather':
        return `Gather from ${e.terrains.join(', ')} tiles (${e.uses} uses)`;
      default:
        return '';
    }
  }).filter(Boolean);
}

export async function GET(_request: NextRequest) {
  // Build craftable items list
  const craftable = CRAFTABLE_ITEMS.map(id => {
    const item = getItemDefinition(id)!;
    return {
      id,
      name: item.name,
      description: item.description,
      category: item.category,
      effects: describeEffects(item),
      recipe: item.recipe,
      uses: item.max_uses,
      max_quantity: item.max_quantity,
    };
  });

  // Build shop items list
  const shop = SHOP_ITEMS.map(id => {
    const item = getItemDefinition(id)!;
    return {
      id,
      name: item.name,
      description: item.description,
      category: item.category,
      effects: describeEffects(item),
      price: item.shop_price,
      uses: item.max_uses,
      max_quantity: item.max_quantity,
    };
  });

  return jsonResponse({
    success: true,
    data: {
      craftable,
      shop,
      info: {
        craft_endpoint: 'POST /api/actions/craft { "item_id": "wooden_pickaxe" }',
        buy_endpoint: 'POST /api/actions/buy { "item_id": "rations", "quantity": 1 }',
        craft_cooldown_seconds: 5,
        max_total_items: 20,
      },
    },
  });
}
