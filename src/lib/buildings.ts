import { ResourceCost } from './crafting';

// =============================================================================
// BUILDINGS SYSTEM
// =============================================================================

export type BuildingType = 'storage' | 'workshop' | 'fortification';

export interface BuildingDefinition {
  name: string;
  description: string;
  build_cost: ResourceCost;
  hourly_upkeep: ResourceCost;
  effect_description: string;
}

export const BUILDING_DEFINITIONS: Record<BuildingType, BuildingDefinition> = {
  storage: {
    name: 'Storage',
    description: 'A sturdy warehouse to store extra resources. Increases your resource cap by 500.',
    build_cost: { wood: 100, stone: 50 },
    hourly_upkeep: { wood: 2, stone: 1 },
    effect_description: '+500 resource cap (all resources)',
  },
  workshop: {
    name: 'Workshop',
    description: 'A crafting workshop with advanced tools. Unlocks advanced recipes and reduces craft cooldown by 50%.',
    build_cost: { wood: 200, stone: 100, gold: 50 },
    hourly_upkeep: { wood: 4, stone: 2, gold: 1 },
    effect_description: 'Unlocks advanced recipes, -50% craft cooldown',
  },
  fortification: {
    name: 'Fortification',
    description: 'Reinforced walls and defenses. Extends territory decay timer and boosts territory gather bonus by +50%.',
    build_cost: { wood: 120, stone: 80, gold: 40 },
    hourly_upkeep: { wood: 3, stone: 2, gold: 1 },
    effect_description: 'Territory decay 24h→72h, +50% territory gather bonus',
  },
};

export const ALL_BUILDING_TYPES = Object.keys(BUILDING_DEFINITIONS) as BuildingType[];

// Building construction cooldown (30 seconds)
export const BUILD_COOLDOWN_MS = 30000;

// Hours without upkeep before building is destroyed
export const BUILDING_DECAY_HOURS = 12;

// =============================================================================
// RESOURCE CAPS
// =============================================================================

// Default resource cap per resource (gold, wood, food, stone)
export const DEFAULT_RESOURCE_CAP = 500;

// Cap increase per Storage building
export const STORAGE_CAP_INCREASE = 500;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get building definition by type
 */
export function getBuildingDefinition(type: string): BuildingDefinition | undefined {
  return BUILDING_DEFINITIONS[type as BuildingType];
}

/**
 * Check if agent has enough resources to build
 */
export function hasResourcesForBuilding(
  agent: { gold: number; wood: number; food: number; stone: number },
  buildingType: BuildingType
): { hasEnough: boolean; missing: string[] } {
  const cost = BUILDING_DEFINITIONS[buildingType].build_cost;
  const missing: string[] = [];

  if (cost.gold && agent.gold < cost.gold) {
    missing.push(`gold (need ${cost.gold}, have ${agent.gold})`);
  }
  if (cost.wood && agent.wood < cost.wood) {
    missing.push(`wood (need ${cost.wood}, have ${agent.wood})`);
  }
  if (cost.food && agent.food < cost.food) {
    missing.push(`food (need ${cost.food}, have ${agent.food})`);
  }
  if (cost.stone && agent.stone < cost.stone) {
    missing.push(`stone (need ${cost.stone}, have ${agent.stone})`);
  }

  return { hasEnough: missing.length === 0, missing };
}

/**
 * Format building cost for display
 */
export function formatBuildingCost(cost: ResourceCost): string {
  const parts: string[] = [];
  if (cost.gold) parts.push(`${cost.gold} gold`);
  if (cost.wood) parts.push(`${cost.wood} wood`);
  if (cost.food) parts.push(`${cost.food} food`);
  if (cost.stone) parts.push(`${cost.stone} stone`);
  return parts.join(', ');
}

/**
 * Calculate resource cap for an agent based on their storage buildings
 */
export function calculateResourceCap(storageCount: number): number {
  return DEFAULT_RESOURCE_CAP + (storageCount * STORAGE_CAP_INCREASE);
}

/**
 * Calculate total hourly upkeep for a set of buildings
 */
export function calculateTotalUpkeep(
  buildings: { building_type: string }[]
): ResourceCost {
  const total: ResourceCost = { gold: 0, wood: 0, food: 0, stone: 0 };
  for (const b of buildings) {
    const def = getBuildingDefinition(b.building_type);
    if (!def) continue;
    total.gold = (total.gold || 0) + (def.hourly_upkeep.gold || 0);
    total.wood = (total.wood || 0) + (def.hourly_upkeep.wood || 0);
    total.food = (total.food || 0) + (def.hourly_upkeep.food || 0);
    total.stone = (total.stone || 0) + (def.hourly_upkeep.stone || 0);
  }
  return total;
}

/**
 * Check if agent has a Workshop building
 */
export function agentHasWorkshop(buildings: { building_type: string }[]): boolean {
  return buildings.some(b => b.building_type === 'workshop');
}

/**
 * Get fortification bonus multiplier (stacks with territory upgrade bonus)
 */
export function getFortificationBonus(buildings: { building_type: string }[], tileX: number, tileY: number, tileBuildings: { x: number; y: number; building_type: string }[]): number {
  // Check if this specific tile has a fortification
  const hasFortification = tileBuildings.some(
    b => b.x === tileX && b.y === tileY && b.building_type === 'fortification'
  );
  return hasFortification ? 1.50 : 1.0;
}

/**
 * Get territory decay hours based on fortification
 */
export function getTerritoryDecayHours(hasFortification: boolean): number {
  return hasFortification ? 72 : 24;
}
