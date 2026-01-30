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
}

// Event types
export type EventType = 'move' | 'gather' | 'trade' | 'speak' | 'join' | 'leave' | 'claim';

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
export const GATHER_COOLDOWN_MS = 5000;
export const MOVE_COOLDOWN_MS = 1000;

// Territory constants
export const CLAIM_COST_GOLD = 50;
export const MAX_TERRITORIES_PER_AGENT = 10;
export const TERRITORY_BONUS_MULTIPLIER = 1.25; // +25% resources on owned tiles
export const TERRITORY_DECAY_HOURS = 24; // Tiles unclaim after 24h of owner inactivity

// Wealth calculation weights
export const WEALTH_WEIGHTS: Record<ResourceType, number> = {
  gold: 1,
  wood: 2,
  stone: 3,
  food: 1,
};

// Calculate total wealth from resources
export function calculateWealth(resources: { gold?: number; wood?: number; food?: number; stone?: number }): number {
  return (
    (resources.gold || 0) * WEALTH_WEIGHTS.gold +
    (resources.wood || 0) * WEALTH_WEIGHTS.wood +
    (resources.stone || 0) * WEALTH_WEIGHTS.stone +
    (resources.food || 0) * WEALTH_WEIGHTS.food
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
