import { TerrainType, ResourceType } from './types';

// =============================================================================
// ITEM & CRAFTING SYSTEM
// =============================================================================

export type ItemCategory = 'tool' | 'equipment' | 'consumable';
export type ItemId = keyof typeof ITEM_DEFINITIONS;

export interface ResourceCost {
  gold?: number;
  wood?: number;
  food?: number;
  stone?: number;
}

// Effect types that items can have
export interface GatherBonus {
  type: 'gather_bonus';
  terrains: TerrainType[] | 'all';
  multiplier: number; // e.g. 1.25 = +25%
}

export interface CooldownReduction {
  type: 'cooldown_reduction';
  action: 'move' | 'gather' | 'trade';
  percent: number; // e.g. 25 = -25%
}

export interface DetectionRange {
  type: 'detection_range';
  range: number; // tile radius
}

export interface UpkeepReduction {
  type: 'upkeep_reduction';
  percent: number; // e.g. 40 = -40%
}

export interface InstantFood {
  type: 'instant_food';
  amount: number;
}

export interface ClaimDiscount {
  type: 'claim_discount';
  percent: number; // e.g. 50 = -50%
}

export interface TerrainGather {
  type: 'terrain_gather';
  terrains: TerrainType[];
  uses: number;
}

export type ItemEffect =
  | GatherBonus
  | CooldownReduction
  | DetectionRange
  | UpkeepReduction
  | InstantFood
  | ClaimDiscount
  | TerrainGather;

export interface ItemDefinition {
  name: string;
  description: string;
  category: ItemCategory;
  effects: ItemEffect[];
  // Crafting recipe (resources needed to craft)
  recipe?: ResourceCost;
  // Shop price (gold-only purchase, mutually exclusive with recipe)
  shop_price?: number;
  // Max uses before item is consumed (null = permanent)
  max_uses: number | null;
  // Max quantity an agent can hold
  max_quantity: number;
  // Cooldown between crafting same item (ms)
  craft_cooldown_ms?: number;
  // Requires a Workshop building to craft
  requires_workshop?: boolean;
}

// Agent's inventory item (from database)
export interface AgentItem {
  id: string;
  agent_id: string;
  item_id: string;
  quantity: number;
  uses_remaining: number | null;
  created_at: string;
  expires_at: string | null;
}

// =============================================================================
// ITEM DEFINITIONS
// =============================================================================

export const ITEM_DEFINITIONS = {
  // =========================================================================
  // TOOLS - Boost specific terrain gathering, limited uses
  // =========================================================================
  wooden_pickaxe: {
    name: 'Wooden Pickaxe',
    description: 'A sturdy pickaxe. +25% stone and gold from mountains.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: ['mountain'] as TerrainType[],
      multiplier: 1.25,
    }],
    recipe: { wood: 40, stone: 10 },
    max_uses: 20,
    max_quantity: 1,
  },
  stone_pickaxe: {
    name: 'Stone Pickaxe',
    description: 'A reinforced pickaxe. +50% stone and gold from mountains. Requires Workshop.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: ['mountain'] as TerrainType[],
      multiplier: 1.50,
    }],
    recipe: { wood: 25, stone: 50, gold: 10 },
    max_uses: 30,
    max_quantity: 1,
    requires_workshop: true,
  },
  fishing_rod: {
    name: 'Fishing Rod',
    description: 'Cast into water for better catches. +30% food from water.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: ['water'] as TerrainType[],
      multiplier: 1.30,
    }],
    recipe: { wood: 30, stone: 8 },
    max_uses: 25,
    max_quantity: 1,
  },
  lumber_axe: {
    name: 'Lumber Axe',
    description: 'Fell trees with ease. +30% wood from forests.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: ['forest'] as TerrainType[],
      multiplier: 1.30,
    }],
    recipe: { wood: 40, stone: 15 },
    max_uses: 20,
    max_quantity: 1,
  },
  harvesting_sickle: {
    name: 'Harvesting Sickle',
    description: 'Efficiently harvest crops. +25% food from plains.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: ['plains'] as TerrainType[],
      multiplier: 1.25,
    }],
    recipe: { wood: 25, stone: 12 },
    max_uses: 20,
    max_quantity: 1,
  },

  // =========================================================================
  // EQUIPMENT - Passive bonuses with durability (uses)
  // =========================================================================
  compass: {
    name: 'Compass',
    description: 'Navigate faster. Move cooldown reduced by 25%. (100 uses)',
    category: 'equipment' as ItemCategory,
    effects: [{
      type: 'cooldown_reduction' as const,
      action: 'move' as const,
      percent: 25,
    }],
    recipe: { gold: 40, stone: 25 },
    max_uses: 100,
    max_quantity: 1,
  },
  backpack: {
    name: 'Backpack',
    description: 'Carry more efficiently. +15% all resource gathering. (50 uses)',
    category: 'equipment' as ItemCategory,
    effects: [{
      type: 'gather_bonus' as const,
      terrains: 'all' as const,
      multiplier: 1.15,
    }],
    recipe: { wood: 60, stone: 40 },
    max_uses: 50,
    max_quantity: 1,
  },
  spyglass: {
    name: 'Spyglass',
    description: 'See further. Nearby agent detection range doubled to 10 tiles. (80 uses) Requires Workshop.',
    category: 'equipment' as ItemCategory,
    effects: [{
      type: 'detection_range' as const,
      range: 10,
    }],
    recipe: { gold: 60, stone: 30 },
    max_uses: 80,
    max_quantity: 1,
    requires_workshop: true,
  },
  reinforced_walls: {
    name: 'Reinforced Walls',
    description: 'Stronger territories. Territory upkeep reduced by 40%. (80 uses) Requires Workshop.',
    category: 'equipment' as ItemCategory,
    effects: [{
      type: 'upkeep_reduction' as const,
      percent: 40,
    }],
    recipe: { wood: 75, stone: 60, gold: 25 },
    max_uses: 80,
    max_quantity: 1,
    requires_workshop: true,
  },

  // =========================================================================
  // CONSUMABLES - Single use, crafted from resources
  // =========================================================================
  provisions: {
    name: 'Provisions',
    description: 'Preserved food rations. Instantly restores 40 food.',
    category: 'consumable' as ItemCategory,
    effects: [{
      type: 'instant_food' as const,
      amount: 40,
    }],
    recipe: { wood: 5, food: 20 },
    max_uses: 1,
    max_quantity: 5,
  },

  // =========================================================================
  // SHOP ITEMS - Bought with gold only
  // =========================================================================
  rations: {
    name: 'Rations',
    description: 'Quick meal. Instantly restores 25 food.',
    category: 'consumable' as ItemCategory,
    effects: [{
      type: 'instant_food' as const,
      amount: 25,
    }],
    shop_price: 20,
    max_uses: 1,
    max_quantity: 5,
  },
  territory_deed: {
    name: 'Territory Deed',
    description: 'Official paperwork. Next territory claim costs 50% less.',
    category: 'consumable' as ItemCategory,
    effects: [{
      type: 'claim_discount' as const,
      percent: 50,
    }],
    shop_price: 75,
    max_uses: 1,
    max_quantity: 1,
  },
  torch: {
    name: 'Torch',
    description: 'Illuminates barren terrain. Gather small resources from rocky and sand tiles.',
    category: 'tool' as ItemCategory,
    effects: [{
      type: 'terrain_gather' as const,
      terrains: ['rocky', 'sand'] as TerrainType[],
      uses: 5,
    }],
    shop_price: 10,
    max_uses: 5,
    max_quantity: 1,
  },
} as const satisfies Record<string, ItemDefinition>;

// Type-safe item ID type
export type ValidItemId = keyof typeof ITEM_DEFINITIONS;

// All valid item IDs
export const ALL_ITEM_IDS = Object.keys(ITEM_DEFINITIONS) as ValidItemId[];

// Items available for crafting (have recipes)
export const CRAFTABLE_ITEMS = ALL_ITEM_IDS.filter(
  id => (ITEM_DEFINITIONS[id] as ItemDefinition).recipe !== undefined
);

// Items available in the shop (have shop_price)
export const SHOP_ITEMS = ALL_ITEM_IDS.filter(
  id => (ITEM_DEFINITIONS[id] as ItemDefinition).shop_price !== undefined
);

// Crafting cooldown (5 seconds between crafts)
export const CRAFT_COOLDOWN_MS = 5000;

// Max total items an agent can hold across all types
export const MAX_TOTAL_ITEMS = 20;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get item definition by ID. Returns undefined for invalid IDs.
 */
export function getItemDefinition(itemId: string): ItemDefinition | undefined {
  return ITEM_DEFINITIONS[itemId as ValidItemId];
}

/**
 * Check if an agent has enough resources for a recipe
 */
export function hasResourcesForRecipe(
  agent: { gold: number; wood: number; food: number; stone: number },
  recipe: ResourceCost
): { hasEnough: boolean; missing: string[] } {
  const missing: string[] = [];

  if (recipe.gold && agent.gold < recipe.gold) {
    missing.push(`gold (need ${recipe.gold}, have ${agent.gold})`);
  }
  if (recipe.wood && agent.wood < recipe.wood) {
    missing.push(`wood (need ${recipe.wood}, have ${agent.wood})`);
  }
  if (recipe.food && agent.food < recipe.food) {
    missing.push(`food (need ${recipe.food}, have ${agent.food})`);
  }
  if (recipe.stone && agent.stone < recipe.stone) {
    missing.push(`stone (need ${recipe.stone}, have ${agent.stone})`);
  }

  return { hasEnough: missing.length === 0, missing };
}

/**
 * Calculate gathering bonus multiplier from all owned items
 * Returns the combined multiplier for a specific terrain type
 */
export function calculateItemGatherBonus(
  items: AgentItem[],
  terrain: TerrainType
): number {
  let multiplier = 1.0;

  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;

    // Skip consumed items
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'gather_bonus') {
        if (effect.terrains === 'all' || effect.terrains.includes(terrain)) {
          // Stack multiplicatively
          multiplier *= effect.multiplier;
        }
      }
    }
  }

  return multiplier;
}

/**
 * Check if agent can gather from a terrain type using items
 * (e.g., torch enables gathering from rocky/sand)
 */
export function canGatherWithItems(
  items: AgentItem[],
  terrain: TerrainType
): boolean {
  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'terrain_gather' && effect.terrains.includes(terrain)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get cooldown reduction percentage for a given action from items
 */
export function getCooldownReduction(
  items: AgentItem[],
  action: 'move' | 'gather' | 'trade'
): number {
  let totalReduction = 0;

  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'cooldown_reduction' && effect.action === action) {
        totalReduction += effect.percent;
      }
    }
  }

  // Cap at 50% reduction
  return Math.min(totalReduction, 50);
}

/**
 * Get detection range bonus from items (default is 5)
 */
export function getDetectionRange(items: AgentItem[]): number {
  let maxRange = 5; // default

  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'detection_range') {
        maxRange = Math.max(maxRange, effect.range);
      }
    }
  }

  return maxRange;
}

/**
 * Get upkeep reduction percentage from items
 */
export function getUpkeepReduction(items: AgentItem[]): number {
  let totalReduction = 0;

  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'upkeep_reduction') {
        totalReduction += effect.percent;
      }
    }
  }

  // Cap at 60% reduction
  return Math.min(totalReduction, 60);
}

/**
 * Format recipe cost for display
 */
export function formatRecipeCost(recipe: ResourceCost): string {
  const parts: string[] = [];
  if (recipe.gold) parts.push(`${recipe.gold} gold`);
  if (recipe.wood) parts.push(`${recipe.wood} wood`);
  if (recipe.food) parts.push(`${recipe.food} food`);
  if (recipe.stone) parts.push(`${recipe.stone} stone`);
  return parts.join(', ');
}

/**
 * Get all items that provide gather bonuses for a terrain, and decrement their uses
 * Returns the item IDs that were used (for logging)
 */
export function getGatherItemsToUse(
  items: AgentItem[],
  terrain: TerrainType
): { itemId: string; itemName: string }[] {
  const used: { itemId: string; itemName: string }[] = [];

  for (const item of items) {
    const def = getItemDefinition(item.item_id);
    if (!def) continue;
    if (def.max_uses !== null && item.uses_remaining !== null && item.uses_remaining <= 0) continue;

    for (const effect of def.effects) {
      if (effect.type === 'gather_bonus') {
        if (effect.terrains === 'all' || effect.terrains.includes(terrain)) {
          used.push({ itemId: item.item_id, itemName: def.name });
        }
      }
      if (effect.type === 'terrain_gather' && effect.terrains.includes(terrain)) {
        used.push({ itemId: item.item_id, itemName: def.name });
      }
    }
  }

  return used;
}
