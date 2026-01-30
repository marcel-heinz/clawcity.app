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

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const r = random(x, y);
      let terrain: TerrainType;

      // Markets at specific locations (trade hubs)
      if ((x === 10 && y === 10) || (x === 40 && y === 40) || 
          (x === 25 && y === 25) || (x === 10 && y === 40) || 
          (x === 40 && y === 10)) {
        terrain = 'market';
      }
      // Water bodies
      else if (
        (x >= 20 && x <= 30 && y >= 0 && y <= 5) ||
        (x >= 0 && x <= 5 && y >= 20 && y <= 30)
      ) {
        terrain = 'water';
      }
      // Mountains in corners and edges
      else if (r < 0.15 || 
               (x < 5 && y < 5) || 
               (x > WORLD_SIZE - 6 && y > WORLD_SIZE - 6)) {
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
