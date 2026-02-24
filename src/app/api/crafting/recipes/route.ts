import { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/auth';
import {
  CRAFTABLE_ITEMS,
  SHOP_ITEMS,
  getItemDefinition,
  type ItemDefinition,
} from '@/lib/crafting';
import { BUILDING_DEFINITIONS } from '@/lib/buildings';
import {
  CLAIM_COST_FOOD,
  CLAIM_COST_GOLD,
  CLAIM_COST_STONE,
  CLAIM_COST_WOOD,
  MAX_UPGRADE_LEVEL,
  SAME_TILE_MIN_EFFICIENCY,
  SAME_TILE_PENALTY,
  STAMINA_COST_CLAIM,
  STAMINA_COST_GATHER,
  UPGRADE_COSTS,
  UPGRADE_BONUSES,
  EFFICIENCY_THRESHOLDS,
} from '@/lib/types';

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
      case 'harvest_scan_range':
        return `${e.range}-tile fresh-tile scan radius`;
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
      requires_workshop: item.requires_workshop || false,
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
        costs: {
          claim: {
            base_cost: {
              gold: CLAIM_COST_GOLD,
              wood: CLAIM_COST_WOOD,
              stone: CLAIM_COST_STONE,
              food_claim_cost: CLAIM_COST_FOOD,
              stamina_cost: STAMINA_COST_CLAIM,
              food_total: CLAIM_COST_FOOD + STAMINA_COST_CLAIM,
            },
            discounts: {
              first_claim_percent: 30,
              territory_deed_percent: 50,
              first_claim_note: 'First claim discount applies only if stronger discount is not available.',
            },
          },
          upgrade: {
            max_level: MAX_UPGRADE_LEVEL,
            levels: Object.entries(UPGRADE_COSTS).map(([level, cost]) => {
              const parsedLevel = Number(level);
              const multiplier = UPGRADE_BONUSES[parsedLevel] ?? UPGRADE_BONUSES[1];
              return {
                level: parsedLevel,
                cost,
                territory_gather_bonus_percent: Math.round((multiplier - 1) * 100),
              };
            }),
          },
          buildings: BUILDING_DEFINITIONS,
        },
        mechanics: {
          stamina_cost_gather: STAMINA_COST_GATHER,
          same_tile_penalty_percent_per_gather: Math.round(SAME_TILE_PENALTY * 100),
          same_tile_min_efficiency_percent: Math.round(SAME_TILE_MIN_EFFICIENCY * 100),
          food_efficiency_thresholds: EFFICIENCY_THRESHOLDS.map((threshold) => ({
            min_food_percent: threshold.minFoodPercent,
            efficiency_percent: Math.round(threshold.multiplier * 100),
          })),
        },
      },
    },
  });
}
