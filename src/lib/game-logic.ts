import { 
  Direction, 
  TerrainType, 
  ResourceType,
  WORLD_SIZE, 
  TERRAIN_RESOURCES 
} from './types';

// Generate a random API key
export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'clawcity_';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Calculate new position based on direction
export function calculateNewPosition(
  x: number, 
  y: number, 
  direction: Direction
): { x: number; y: number } {
  const moves: Record<Direction, { dx: number; dy: number }> = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    east: { dx: 1, dy: 0 },
    west: { dx: -1, dy: 0 },
  };

  const move = moves[direction];
  const newX = Math.max(0, Math.min(WORLD_SIZE - 1, x + move.dx));
  const newY = Math.max(0, Math.min(WORLD_SIZE - 1, y + move.dy));

  return { x: newX, y: newY };
}

// Calculate resources gathered from a terrain type
export function calculateGatheredResources(terrain: TerrainType): Record<ResourceType, number> {
  const result: Record<ResourceType, number> = {
    gold: 0,
    wood: 0,
    food: 0,
    stone: 0,
  };

  const terrainResources = TERRAIN_RESOURCES[terrain];
  
  for (const [resource, range] of Object.entries(terrainResources)) {
    if (range) {
      result[resource as ResourceType] = Math.floor(
        Math.random() * (range.max - range.min + 1) + range.min
      );
    }
  }

  return result;
}

// Generate world tiles
export function generateWorldTiles(): Array<{ x: number; y: number; terrain: TerrainType; resources: Record<string, number> }> {
  const tiles: Array<{ x: number; y: number; terrain: TerrainType; resources: Record<string, number> }> = [];
  
  // Seed for deterministic generation
  const seed = 42;
  const random = (x: number, y: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
  };

  // Market locations spread across the 500x500 world (25 markets in a 5x5 grid pattern)
  const marketLocations = new Set<string>();
  for (let mx = 0; mx < 5; mx++) {
    for (let my = 0; my < 5; my++) {
      const marketX = 50 + mx * 100; // Markets at 50, 150, 250, 350, 450
      const marketY = 50 + my * 100;
      marketLocations.add(`${marketX},${marketY}`);
    }
  }

  // Helper to check if position is in a water body
  const isWater = (x: number, y: number): boolean => {
    // Large lakes scattered across the map
    const lakes = [
      { cx: 100, cy: 100, r: 30 },
      { cx: 400, cy: 100, r: 25 },
      { cx: 100, cy: 400, r: 25 },
      { cx: 400, cy: 400, r: 30 },
      { cx: 250, cy: 250, r: 40 }, // Central lake
    ];
    
    for (const lake of lakes) {
      const dist = Math.sqrt((x - lake.cx) ** 2 + (y - lake.cy) ** 2);
      if (dist <= lake.r) return true;
    }
    
    // Rivers
    if (Math.abs(y - 200) <= 5 && x > 50 && x < 450) return true; // Horizontal river
    if (Math.abs(x - 300) <= 5 && y > 100 && y < 400) return true; // Vertical river
    
    return false;
  };

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const r = random(x, y);
      let terrain: TerrainType;

      // Markets at specific locations (trade hubs)
      if (marketLocations.has(`${x},${y}`)) {
        terrain = 'market';
      }
      // Water bodies
      else if (isWater(x, y)) {
        terrain = 'water';
      }
      // Mountains in corners and mountain ranges
      else if (
        r < 0.08 || 
        (x < 20 && y < 20) || 
        (x > WORLD_SIZE - 21 && y > WORLD_SIZE - 21) ||
        (x < 20 && y > WORLD_SIZE - 21) ||
        (x > WORLD_SIZE - 21 && y < 20) ||
        // Mountain ranges
        (Math.abs(y - x) < 10 && x > 150 && x < 350) // Diagonal range
      ) {
        terrain = 'mountain';
      }
      // Forests
      else if (r < 0.4) {
        terrain = 'forest';
      }
      // Plains (default)
      else {
        terrain = 'plains';
      }

      tiles.push({
        x,
        y,
        terrain,
        resources: {},
      });
    }
  }

  return tiles;
}

// Check if agent has enough resources for a trade
export function hasEnoughResources(
  agentResources: Record<string, number>,
  required: Record<string, number>
): boolean {
  for (const [resource, amount] of Object.entries(required)) {
    if ((agentResources[resource] || 0) < amount) {
      return false;
    }
  }
  return true;
}

// Calculate distance between two points
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2); // Manhattan distance
}

// Check if two agents are nearby (for trading)
export function areAgentsNearby(
  agent1: { x: number; y: number },
  agent2: { x: number; y: number },
  maxDistance: number = 3
): boolean {
  return distance(agent1.x, agent1.y, agent2.x, agent2.y) <= maxDistance;
}

// Format event message for display
export function formatEventMessage(event: {
  type: string;
  agent_name?: string;
  data: Record<string, unknown>;
}): string {
  const name = event.agent_name || 'Unknown';
  
  switch (event.type) {
    case 'move':
      return `${name} moved ${event.data.direction}`;
    case 'gather':
      const resources = event.data.resources as Record<string, number>;
      const gathered = Object.entries(resources)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      return `${name} gathered ${gathered || 'nothing'}`;
    case 'trade':
      return `${name} traded with ${event.data.target_name || 'someone'}`;
    case 'speak':
      return `${name}: "${event.data.message}"`;
    case 'join':
      return `${name} joined the world`;
    case 'leave':
      return `${name} left the world`;
    default:
      return `${name} did something`;
  }
}

// Get terrain color class
export function getTerrainColorClass(terrain: TerrainType): string {
  const colors: Record<TerrainType, string> = {
    plains: 'terrain-plains',
    forest: 'terrain-forest',
    mountain: 'terrain-mountain',
    market: 'terrain-market',
    water: 'terrain-water',
  };
  return colors[terrain];
}
