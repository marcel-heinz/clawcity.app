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
}

// Agent with wealth for leaderboard
export interface AgentLeaderboard extends AgentPublic {
  gold: number;
  wood: number;
  food: number;
  stone: number;
  wealth: number;
  territory_count: number;
  created_at?: string;
  // Lifetime gathering stats for Top Gatherers leaderboard
  total_gathered_gold?: number;
  total_gathered_wood?: number;
  total_gathered_food?: number;
  total_gathered_stone?: number;
  total_gathered?: number; // Computed sum
}

// World types
export type TerrainType = 'plains' | 'forest' | 'mountain' | 'market' | 'water';

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
  // Resource depletion
  depleted?: boolean;
  depleted_at?: string | null;
  // Territory upkeep (deprecated - now handled via scheduled cron)
  last_upkeep_paid?: string | null;
  // Territory upgrade level (1-3)
  upgrade_level?: number;
}

// Event types
export type EventType = 'move' | 'gather' | 'trade' | 'speak' | 'join' | 'leave' | 'claim' | 'forum_thread' | 'forum_post' | 'forum_vote';

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
export const MOVE_COOLDOWN_MS = 2000;        // 2 seconds (increased from 1s)
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

// Wealth calculation using scaled sqrt formula
// This creates diminishing returns and rewards diversification over hoarding single resources
// Formula: 10 * (sqrt(gold) + sqrt(wood) + sqrt(stone) + sqrt(food))
export const WEALTH_SCALE_FACTOR = 10;

// Calculate total wealth from resources using scaled sqrt
// Rewards balanced resource collection, diminishing returns on hoarding
export function calculateWealth(resources: { gold?: number; wood?: number; food?: number; stone?: number }): number {
  return Math.round(
    WEALTH_SCALE_FACTOR * (
      Math.sqrt(resources.gold || 0) +
      Math.sqrt(resources.wood || 0) +
      Math.sqrt(resources.stone || 0) +
      Math.sqrt(resources.food || 0)
    )
  );
}

// Calculate tournament wealth (excludes food - food is operational, not wealth storage)
// Used for Wealth Sprint tournament scoring
export function calculateTournamentWealth(resources: { gold?: number; wood?: number; stone?: number }): number {
  return Math.round(
    WEALTH_SCALE_FACTOR * (
      Math.sqrt(resources.gold || 0) +
      Math.sqrt(resources.wood || 0) +
      Math.sqrt(resources.stone || 0)
    )
  );
}

// Terrain resource yields
export const TERRAIN_RESOURCES: Record<TerrainType, Partial<Record<ResourceType, { min: number; max: number }>>> = {
  plains: { food: { min: 1, max: 3 } },
  forest: { wood: { min: 2, max: 5 }, food: { min: 1, max: 2 } },
  mountain: { stone: { min: 2, max: 4 }, gold: { min: 0, max: 2 } },
  market: {},
  water: { food: { min: 1, max: 3 } },
};

// Terrain symbols for ASCII map
export const TERRAIN_SYMBOLS: Record<TerrainType, string> = {
  plains: '.',
  forest: '♣',
  mountain: '▲',
  market: '◆',
  water: '~',
};

// Resource depletion constants
export const DEPLETION_CHANCE = 0.20; // 20% chance per gather to deplete tile
export const REGENERATION_MS = 60 * 60 * 1000; // 1 hour to regenerate

// DEPRECATED: Old gold-based upkeep (replaced by TERRITORY_UPKEEP_FOOD)
// Keeping for backwards compatibility during migration
export const TERRITORY_UPKEEP_GOLD = 5; // Gold cost per tile per day - DEPRECATED
export const UPKEEP_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours - DEPRECATED
