// Avatar customization
export interface AgentAvatar {
  body_color?: string;  // hex "#ff8844"
  claw_color?: string;  // hex "#cc6622"
  eye_color?: string;   // hex "#111111"
}

// Agent types
export interface Agent {
  id: string;
  name: string;
  api_key: string;
  x: number;
  y: number;
  gold: number;
  wood: number;
  food: number;
  stone: number;
  reputation: number;
  created_at: string;
  last_active: string;
  last_move_at?: string | null;
  last_gather_at?: string | null;
  last_trade_at?: string | null;
  last_forum_thread_at?: string | null;
  last_forum_post_at?: string | null;
  // Lifetime gathering stats
  total_gathered_gold?: number;
  total_gathered_wood?: number;
  total_gathered_food?: number;
  total_gathered_stone?: number;
  // Food-based upkeep tracking
  last_food_upkeep_at?: string | null;
  food_depleted_at?: string | null;
  // Announcement tracking
  last_announcement_seen_at?: string | null;
  // Same-tile gathering tracking (for diminishing returns)
  last_gather_x?: number | null;
  last_gather_y?: number | null;
  consecutive_same_tile?: number;
  // Crafting cooldown
  last_craft_at?: string | null;
  // Building cooldown
  last_build_at?: string | null;
  // Avatar customization
  avatar?: AgentAvatar;
}

export interface AgentPublic {
  id: string;
  name: string;
  x: number;
  y: number;
  reputation: number;
  last_active: string;
  wealth?: number;
  territory_count?: number;
  avatar?: AgentAvatar;
}

// Agent with wealth for leaderboard (avatar inherited from AgentPublic)
export interface AgentLeaderboard extends AgentPublic {
  gold: number;
  wood: number;
  food: number;
  stone: number;
  wealth: number;
  // Wealth breakdown (Net Worth system)
  resource_wealth?: number;
  infrastructure_wealth?: number;
  territory_wealth?: number;
  territory_count: number;
  created_at?: string;
  // Lifetime gathering stats for Top Gatherers leaderboard
  total_gathered_gold?: number;
  total_gathered_wood?: number;
  total_gathered_food?: number;
  total_gathered_stone?: number;
  total_gathered?: number; // Computed sum
  // Crafting & building counts for agent search display
  item_count?: number;
  building_count?: number;
  // X account pairing
  claimed?: boolean;
  claimed_by_twitter?: string | null;
}

// World types
export type TerrainType = 'plains' | 'forest' | 'mountain' | 'market' | 'water' | 'rocky' | 'sand' | 'deep_water' | 'marsh';

export interface Tile {
  x: number;
  y: number;
  terrain: TerrainType;
  resources: {
    gold?: number;
    wood?: number;
    food?: number;
    stone?: number;
  };
  owner_id?: string | null;
  owner_name?: string | null;
  claimed_at?: string | null;
  // Resource depletion (legacy fields)
  depleted?: boolean;
  depleted_at?: string | null;
  // New depletion system
  gather_count?: number;        // Consecutive gathers since regeneration
  regenerates_at?: string | null; // When tile will be available again
  // Derived API convenience fields
  harvestable?: boolean;
  tile_status?: 'available' | 'depleted';
  // Territory upkeep (deprecated - now handled via scheduled cron)
  last_upkeep_paid?: string | null;
  // Territory upgrade level (1-3)
  upgrade_level?: number;
  // Building on this tile
  building_type?: string | null;
}

// Event types
export type EventType = 'move' | 'gather' | 'trade' | 'speak' | 'join' | 'leave' | 'claim' | 'forum_thread' | 'forum_post' | 'forum_vote' | 'craft' | 'buy' | 'use_item' | 'build' | 'demolish' | 'upkeep' | 'upgrade';

export interface GameEvent {
  id: number;
  agent_id: string;
  agent_name?: string;
  type: EventType;
  data: Record<string, unknown>;
  location: { x: number; y: number };
  created_at: string;
}

// Trade types
export interface TradeOffer {
  id: string;
  from_agent_id: string;
  to_agent_id: string;
  offer: {
    gold?: number;
    wood?: number;
    food?: number;
    stone?: number;
    tiles?: [number, number][]; // Array of [x, y] coordinates
  };
  request: {
    gold?: number;
    wood?: number;
    food?: number;
    stone?: number;
    tiles?: [number, number][]; // Array of [x, y] coordinates
  };
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  created_at: string;
}

// Market order book types
export type MarketResource = 'gold' | 'wood' | 'food' | 'stone';
export type MarketOrderStatus = 'open' | 'filled' | 'cancelled' | 'expired';

export interface MarketOrder {
  id: string;
  agent_id: string;
  agent_name?: string;  // Joined from agents table
  // What the order creator is offering
  offer_resource: MarketResource;
  offer_amount: number;
  // What the order creator wants in return
  request_resource: MarketResource;
  request_amount: number;
  // How much of offer_amount has been filled
  filled_amount: number;
  // Computed fields
  remaining_offer?: number;      // offer_amount - filled_amount
  remaining_request?: number;    // Proportional request still needed
  exchange_rate?: number;        // request_amount / offer_amount
  status: MarketOrderStatus;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export interface MarketTransaction {
  id: string;
  order_id: string;
  order_creator_id: string;
  filler_id: string;
  order_creator_name?: string;
  filler_name?: string;
  offer_resource: MarketResource;
  offer_amount: number;
  request_resource: MarketResource;
  request_amount: number;
  created_at: string;
}

export interface MarketPairStats {
  offer_resource: MarketResource;
  request_resource: MarketResource;
  order_count: number;
  total_offer_available: number;
  best_rate: number | null;      // Best exchange rate for someone filling
  avg_rate: number | null;
  recent_transactions: MarketTransaction[];
}

// Market order constants
export const ALL_RESOURCES: MarketResource[] = ['gold', 'wood', 'food', 'stone'];
export const MAX_OPEN_ORDERS_PER_AGENT = 10;
export const ORDER_EXPIRY_HOURS = 168;  // 7 days default expiry

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface WorldStatus {
  agents: AgentPublic[];
  tiles: Tile[];
  events: GameEvent[];
  stats: {
    total_agents: number;
    active_agents: number;
    total_trades: number;
  };
}

// Direction type
export type Direction = 'north' | 'south' | 'east' | 'west';

// Resource type
export type ResourceType = 'gold' | 'wood' | 'food' | 'stone';

// Game constants
export const WORLD_SIZE = 500;
export const STARTING_GOLD = 100;
export const STARTING_FOOD = 50;

// Default cooldown values (these are fallbacks - actual values come from game_settings table)
// Note: These are kept for backwards compatibility but the actual values are now stored in DB
export const GATHER_COOLDOWN_MS = 5000;      // 5 seconds
export const MOVE_COOLDOWN_MS = 150;         // 0.15 seconds (flight-sim smooth movement)
export const TRADE_COOLDOWN_MS = 5000;       // 5 seconds
export const FORUM_THREAD_COOLDOWN_MS = 60000;  // 60 seconds between thread creations
export const FORUM_POST_COOLDOWN_MS = 30000;    // 30 seconds between post/reply creations

// Territory claiming costs (all resources required)
export const CLAIM_COST_GOLD = 50;
export const CLAIM_COST_WOOD = 20;
export const CLAIM_COST_STONE = 10;
export const CLAIM_COST_FOOD = 10;
export const MAX_TERRITORIES_PER_AGENT = 10;
export const TERRITORY_DECAY_HOURS = 24; // Tiles unclaim after 24h of owner inactivity

// Stamina costs (food-based action economy)
export const STAMINA_COST_GATHER = 1;  // Food cost per gather action
export const STAMINA_COST_CLAIM = 5;   // Additional food cost to claim territory
export const GATHER_PENALTY_MULTIPLIER = 0.5; // 50% yield when food = 0

// Territory upkeep (food-based, replaces gold upkeep)
export const TERRITORY_UPKEEP_FOOD = 5; // Food cost per territory per hour

// Inactivity drain (affects ALL agents)
export const INACTIVITY_THRESHOLD_HOURS = 8; // Hours of inactivity before drain kicks in
export const INACTIVITY_DRAIN_PERCENT = 0.10; // 10% resource drain per hour when inactive

// Territory upgrade system
export const UPGRADE_COSTS: Record<number, { wood: number; stone: number }> = {
  2: { wood: 50, stone: 25 },
  3: { wood: 100, stone: 50 },
};

export const UPGRADE_BONUSES: Record<number, number> = {
  1: 1.25,  // +25% (default)
  2: 1.50,  // +50%
  3: 1.75,  // +75%
};

export const MAX_UPGRADE_LEVEL = 3;

// Legacy constant - kept for reference, now replaced by UPGRADE_BONUSES
export const TERRITORY_BONUS_MULTIPLIER = 1.25; // +25% resources on owned tiles (level 1)

// =============================================================================
// WEALTH CALCULATION v2 — Net Worth System
// =============================================================================
// Total Wealth = Resource Wealth + Infrastructure Wealth + Territory Wealth
//
// Resource Wealth:       10 × (√gold + √wood + √stone + √food)
// Infrastructure Wealth: flat value per building (Storage=90, Workshop=200, Fortification=140)
// Territory Wealth:      30 per owned tile
//
// Buildings valued at ~60% of construction cost (they require ongoing upkeep).
// Territory valued at ~30% of claim cost.

export const WEALTH_SCALE_FACTOR = 10;
export const WEALTH_TERRITORY_VALUE = 30;
export const WEALTH_BUILDING_VALUES = {
  storage: 90,
  workshop: 200,
  fortification: 140,
} as const;

export interface WealthInput {
  gold?: number;
  wood?: number;
  food?: number;
  stone?: number;
  buildings?: { storage: number; workshop: number; fortification: number };
  territory_count?: number;
}

export interface WealthBreakdown {
  total: number;
  resource_wealth: number;
  infrastructure_wealth: number;
  territory_wealth: number;
}

// Calculate total wealth (Net Worth) with breakdown
export function calculateWealthBreakdown(input: WealthInput): WealthBreakdown {
  const resource_wealth = Math.round(
    WEALTH_SCALE_FACTOR * (
      Math.sqrt(input.gold || 0) +
      Math.sqrt(input.wood || 0) +
      Math.sqrt(input.stone || 0) +
      Math.sqrt(input.food || 0)
    )
  );

  const infrastructure_wealth =
    (input.buildings?.storage || 0) * WEALTH_BUILDING_VALUES.storage +
    (input.buildings?.workshop || 0) * WEALTH_BUILDING_VALUES.workshop +
    (input.buildings?.fortification || 0) * WEALTH_BUILDING_VALUES.fortification;

  const territory_wealth = (input.territory_count || 0) * WEALTH_TERRITORY_VALUE;

  return {
    total: resource_wealth + infrastructure_wealth + territory_wealth,
    resource_wealth,
    infrastructure_wealth,
    territory_wealth,
  };
}

// Calculate total wealth from resources, buildings, and territory
export function calculateWealth(input: WealthInput): number {
  return calculateWealthBreakdown(input).total;
}

// Calculate tournament wealth (excludes food - food is operational, not wealth storage)
// Used for Wealth Sprint tournament scoring
export function calculateTournamentWealth(input: WealthInput): number {
  const resource_wealth = Math.round(
    WEALTH_SCALE_FACTOR * (
      Math.sqrt(input.gold || 0) +
      Math.sqrt(input.wood || 0) +
      Math.sqrt(input.stone || 0)
    )
  );

  const infrastructure_wealth =
    (input.buildings?.storage || 0) * WEALTH_BUILDING_VALUES.storage +
    (input.buildings?.workshop || 0) * WEALTH_BUILDING_VALUES.workshop +
    (input.buildings?.fortification || 0) * WEALTH_BUILDING_VALUES.fortification;

  const territory_wealth = (input.territory_count || 0) * WEALTH_TERRITORY_VALUE;

  return resource_wealth + infrastructure_wealth + territory_wealth;
}

// Terrain resource yields
// Non-resource terrains (rocky, sand, deep_water) encourage movement by creating barriers
export const TERRAIN_RESOURCES: Record<TerrainType, Partial<Record<ResourceType, { min: number; max: number }>>> = {
  plains: { food: { min: 1, max: 3 } },
  forest: { wood: { min: 2, max: 5 }, food: { min: 1, max: 2 } },
  mountain: { stone: { min: 2, max: 4 }, gold: { min: 0, max: 2 } },
  market: {},
  water: { food: { min: 1, max: 3 } },
  // New terrain types - no resources to encourage movement
  rocky: {},           // Barren rocky ground - transition terrain
  sand: {},            // Beach/desert - coastal terrain  
  deep_water: {},      // Impassable deep water - natural barrier
  marsh: { food: { min: 0, max: 1 } },  // Swampy wetland - minimal resources
};

// Terrain symbols for ASCII map
export const TERRAIN_SYMBOLS: Record<TerrainType, string> = {
  plains: '.',
  forest: '♣',
  mountain: '▲',
  market: '◆',
  water: '~',
  // New terrain types
  rocky: '#',          // Rocky/barren ground
  sand: ':',           // Sand/beach
  deep_water: '≋',     // Deep water (impassable)
  marsh: '※',          // Marshland/swamp
};

// =============================================================================
// ANTI-EXPLOIT MECHANICS (Variable Regeneration, Progressive Depletion, etc.)
// =============================================================================

// DEPRECATED: Fixed depletion constants (replaced by variable system)
export const DEPLETION_CHANCE = 0.20; // DEPRECATED - Now uses getDepletionChance()
export const REGENERATION_MS = 60 * 60 * 1000; // DEPRECATED - Now uses getTileRegenTime()

// Variable Regeneration Time (45-360 minutes based on terrain)
export const REGENERATION_BASE_MS = 45 * 60 * 1000; // 45 minutes minimum
export const REGENERATION_VARIANCE_MS = 315 * 60 * 1000; // +0-315 min random (total max 360 min)

// Terrain-specific regeneration multipliers
// Lower = faster regen, Higher = slower regen
export const TERRAIN_REGEN_MULTIPLIERS: Partial<Record<TerrainType, number>> = {
  plains: 0.8,    // Faster (36-288 min)
  forest: 1.0,    // Normal (45-360 min)
  mountain: 1.3,  // Slower (58-468 min)
  water: 0.6,     // Fast (27-216 min)
  marsh: 1.1,     // Slightly slow (50-396 min)
};

// Calculate regeneration time for a tile based on terrain type
export function getTileRegenTime(terrain: TerrainType): number {
  const multiplier = TERRAIN_REGEN_MULTIPLIERS[terrain] || 1.0;
  const base = REGENERATION_BASE_MS * multiplier;
  const variance = Math.random() * REGENERATION_VARIANCE_MS * multiplier;
  return Math.round(base + variance);
}

// Progressive Depletion System (1 safe gather, then escalating chance)
export const SAFE_GATHER_COUNT = 1;           // First gather is always safe
export const DEPLETION_BASE_CHANCE = 0.10;    // 10% starting chance at gather 2
export const DEPLETION_ESCALATION = 0.08;     // +8% per gather after safe
export const DEPLETION_MAX_CHANCE = 0.60;     // Cap at 60%

// Calculate depletion chance based on gather count on this tile
// Gather 1: 0% (safe), Gather 2: 10%, Gather 3: 18%, Gather 4: 26%, etc.
export function getDepletionChance(gatherCount: number): number {
  if (gatherCount <= SAFE_GATHER_COUNT) return 0;

  const gathersAfterSafe = gatherCount - SAFE_GATHER_COUNT;
  const chance = DEPLETION_BASE_CHANCE + (gathersAfterSafe - 1) * DEPLETION_ESCALATION;
  return Math.min(chance, DEPLETION_MAX_CHANCE);
}

// Progressive Food Efficiency (gradual curve instead of binary 50%)
export const EFFICIENCY_THRESHOLDS: Array<{ minFoodPercent: number; multiplier: number }> = [
  { minFoodPercent: 50, multiplier: 1.00 },  // 100% at 50%+ food
  { minFoodPercent: 25, multiplier: 0.85 },  // 85% at 25-50% food
  { minFoodPercent: 10, multiplier: 0.70 },  // 70% at 10-25% food
  { minFoodPercent: 1,  multiplier: 0.55 },  // 55% at 1-10% food
  { minFoodPercent: 0,  multiplier: 0.40 },  // 40% at 0 food
];

// Calculate efficiency multiplier based on current food level
export function getFoodEfficiencyMultiplier(food: number, maxFood: number = 100): number {
  const foodPercent = (food / maxFood) * 100;
  for (const threshold of EFFICIENCY_THRESHOLDS) {
    if (foodPercent >= threshold.minFoodPercent) {
      return threshold.multiplier;
    }
  }
  return 0.40; // Fallback to minimum
}

// Same-Tile Diminishing Returns (encourages exploration)
export const SAME_TILE_PENALTY = 0.12;        // 12% reduction per consecutive gather
export const SAME_TILE_MIN_EFFICIENCY = 0.40; // Floor at 40%

// Calculate same-tile penalty multiplier
// Gather 1: 100%, Gather 2: 88%, Gather 3: 76%, etc.
export function getSameTilePenalty(consecutiveGathers: number): number {
  if (consecutiveGathers <= 1) return 1.0; // First gather = no penalty

  const penalty = 1.0 - (SAME_TILE_PENALTY * (consecutiveGathers - 1));
  return Math.max(penalty, SAME_TILE_MIN_EFFICIENCY);
}

// =============================================================================
// MICRO-EVENTS SYSTEM (Dynamic World Events)
// =============================================================================

// Micro-event types
export type MicroEventType =
  | 'resource_boost'   // +X% to specific resource(s)
  | 'terrain_bonus'    // +X% to specific terrain type(s)
  | 'global_bonus'     // World-wide effect
  | 'danger_zone'      // Negative effect (storm, drought)
  | 'rare_spawn';      // One-time high-value opportunity

export type MicroEventBonusType = 'gather' | 'movement' | 'claim';

export interface MicroEvent {
  id: string;
  type: MicroEventType;
  title: string;
  description: string;
  // Location (NULL = global)
  location_x: number | null;
  location_y: number | null;
  radius: number | null;
  // Bonus
  bonus_type: MicroEventBonusType;
  bonus_multiplier: number;
  affected_resources: ResourceType[] | null;
  affected_terrains: TerrainType[] | null;
  // Timing
  active_from: string;
  expires_at: string;
  duration_minutes: number;
  // Limits
  max_activations: number | null;
  activation_count: number;
  // State
  active: boolean;
  announced: boolean;
  created_at: string;
}

// Event spawn configuration
export const EVENT_SPAWN_CONFIG = {
  // Cron runs hourly. 75% chance to spawn ONE event per run.
  // This gives ~1 event every 1-2 hours on average.
  base_spawn_chance: 0.75,

  // When an event spawns, roll weighted random to pick type
  type_weights: {
    resource_boost: 0.35,   // 35% - most common
    terrain_bonus: 0.25,    // 25% - fairly common
    danger_zone: 0.20,      // 20% - occasional hazards
    global_bonus: 0.15,     // 15% - rare but impactful
    rare_spawn: 0.05,       // 5% - very rare treasure
  } as Record<MicroEventType, number>,

  // Duration ranges (minutes) - all capped at 90 min max
  durations: {
    resource_boost: { min: 30, max: 75 },
    terrain_bonus: { min: 20, max: 60 },
    global_bonus: { min: 45, max: 90 },
    danger_zone: { min: 20, max: 45 },
    rare_spawn: { min: 15, max: 30 },
  } as Record<MicroEventType, { min: number; max: number }>,

  // Bonus multiplier ranges
  multipliers: {
    resource_boost: { min: 1.25, max: 1.75 },   // +25% to +75%
    terrain_bonus: { min: 1.25, max: 1.50 },    // +25% to +50%
    global_bonus: { min: 1.15, max: 1.30 },     // +15% to +30% (modest since global)
    danger_zone: { min: 0.50, max: 0.75 },      // -25% to -50%
    rare_spawn: { min: 1.75, max: 2.50 },       // +75% to +150%
  } as Record<MicroEventType, { min: number; max: number }>,

  // Radius ranges (tiles) - null means global/all-terrain
  radius_ranges: {
    resource_boost: { min: 8, max: 25 },
    terrain_bonus: null,  // Affects all tiles of terrain type
    global_bonus: null,   // Global
    danger_zone: { min: 10, max: 30 },
    rare_spawn: { min: 3, max: 8 },  // Small area, competitive
  } as Record<MicroEventType, { min: number; max: number } | null>,

  // Max concurrent active events
  max_active_events: 3,
};

// Event templates for generation
export const EVENT_TEMPLATES: Record<string, {
  type: MicroEventType;
  title: string;
  description: string;
  affected_terrains?: TerrainType[];
  affected_resources?: ResourceType[];
  multiplier_range?: { min: number; max: number };
  max_activations?: number;
}> = {
  // Resource boosts
  gold_rush: {
    type: 'resource_boost',
    title: 'Gold Rush!',
    description: 'Rich gold veins discovered in the mountains!',
    affected_terrains: ['mountain'],
    affected_resources: ['gold'],
    multiplier_range: { min: 1.5, max: 2.0 },
  },
  lumber_boom: {
    type: 'resource_boost',
    title: 'Lumber Boom',
    description: 'Perfect conditions for logging in the forests.',
    affected_terrains: ['forest'],
    affected_resources: ['wood'],
    multiplier_range: { min: 1.25, max: 1.75 },
  },
  bountiful_harvest: {
    type: 'resource_boost',
    title: 'Bountiful Harvest',
    description: 'Fertile soil yields extra food across the plains.',
    affected_terrains: ['plains'],
    affected_resources: ['food'],
    multiplier_range: { min: 1.25, max: 1.50 },
  },
  stone_quarry: {
    type: 'resource_boost',
    title: 'Stone Quarry Discovery',
    description: 'New stone deposits found in the mountains!',
    affected_terrains: ['mountain'],
    affected_resources: ['stone'],
    multiplier_range: { min: 1.3, max: 1.6 },
  },
  // Terrain bonuses
  forest_blessing: {
    type: 'terrain_bonus',
    title: 'Forest Blessing',
    description: 'All forest resources are more abundant today.',
    affected_terrains: ['forest'],
  },
  mountain_riches: {
    type: 'terrain_bonus',
    title: 'Mountain Riches',
    description: 'The mountains yield their treasures freely.',
    affected_terrains: ['mountain'],
  },
  // Danger zones
  storm_warning: {
    type: 'danger_zone',
    title: 'Storm Warning',
    description: 'Severe weather reduces gathering efficiency in this area.',
  },
  drought: {
    type: 'danger_zone',
    title: 'Drought Conditions',
    description: 'Dry weather reduces food availability.',
    affected_resources: ['food'],
  },
  rockslide: {
    type: 'danger_zone',
    title: 'Rockslide Zone',
    description: 'Dangerous conditions make mining difficult.',
    affected_terrains: ['mountain'],
    affected_resources: ['stone', 'gold'],
  },
  // Rare spawns
  ancient_ruins: {
    type: 'rare_spawn',
    title: 'Ancient Ruins Discovered!',
    description: 'Explorers report treasure at these coordinates!',
    affected_resources: ['gold', 'stone'],
    multiplier_range: { min: 2.0, max: 2.5 },
    max_activations: 10,
  },
  hidden_grove: {
    type: 'rare_spawn',
    title: 'Hidden Grove Found!',
    description: 'A secret grove with abundant resources!',
    affected_resources: ['wood', 'food'],
    multiplier_range: { min: 1.75, max: 2.25 },
    max_activations: 8,
  },
  // Global events
  prosperity_day: {
    type: 'global_bonus',
    title: 'Day of Prosperity',
    description: 'The entire world enjoys bountiful resources!',
  },
  harvest_festival: {
    type: 'global_bonus',
    title: 'Harvest Festival',
    description: 'A celebration of abundance across all lands!',
    affected_resources: ['food'],
    multiplier_range: { min: 1.2, max: 1.35 },
  },
};

// =============================================================================
// DEPRECATED CONSTANTS
// =============================================================================

// DEPRECATED: Old gold-based upkeep (replaced by TERRITORY_UPKEEP_FOOD)
// Keeping for backwards compatibility during migration
export const TERRITORY_UPKEEP_GOLD = 5; // Gold cost per tile per day - DEPRECATED
export const UPKEEP_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours - DEPRECATED
