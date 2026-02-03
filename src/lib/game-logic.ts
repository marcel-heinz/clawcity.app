import { 
  Direction, 
  TerrainType, 
  ResourceType,
  WORLD_SIZE, 
  TERRAIN_RESOURCES,
  MOVE_COOLDOWN_MS,
  GATHER_COOLDOWN_MS,
  TRADE_COOLDOWN_MS
} from './types';
import { randomBytes, createHash } from 'crypto';

// ============================================================================
// SIMPLEX NOISE IMPLEMENTATION
// ============================================================================

/**
 * Simplex noise generator for natural terrain generation
 * Creates smooth, natural-looking noise that clusters similar values together
 */
class SimplexNoise {
  private perm: number[];
  private gradP: number[][];

  constructor(seed: number = 42) {
    this.perm = new Array(512);
    this.gradP = new Array(512);

    const grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]
    ];

    const p: number[] = [];
    for (let i = 0; i < 256; i++) p[i] = i;

    // Shuffle based on seed using LCG
    let n = seed;
    for (let i = 255; i > 0; i--) {
      n = (n * 16807) % 2147483647;
      const j = n % (i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }

    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.gradP[i] = grad3[this.perm[i] % 12];
    }
  }

  private dot2(g: number[], x: number, y: number): number {
    return g[0] * x + g[1] * y;
  }

  /**
   * 2D Simplex noise
   * @returns Value between -1 and 1
   */
  noise2D(x: number, y: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    const s = (x + y) * F2;
    let i = Math.floor(x + s);
    let j = Math.floor(y + s);

    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    i &= 255;
    j &= 255;

    const gi0 = this.gradP[i + this.perm[j]];
    const gi1 = this.gradP[i + i1 + this.perm[j + j1]];
    const gi2 = this.gradP[i + 1 + this.perm[j + 1]];

    let n0: number, n1: number, n2: number;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 < 0) n0 = 0;
    else {
      t0 *= t0;
      n0 = t0 * t0 * this.dot2(gi0, x0, y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 < 0) n1 = 0;
    else {
      t1 *= t1;
      n1 = t1 * t1 * this.dot2(gi1, x1, y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 < 0) n2 = 0;
    else {
      t2 *= t2;
      n2 = t2 * t2 * this.dot2(gi2, x2, y2);
    }

    // Returns value in range [-1, 1]
    return 70 * (n0 + n1 + n2);
  }
}

// Generate a cryptographically secure random API key
export function generateApiKey(): string {
  // Use 24 bytes = 32 base64 chars (after removing padding)
  const bytes = randomBytes(24);
  const token = bytes.toString('base64url');
  return `clawcity_${token}`;
}

// Generate a cryptographically secure claim token for agent ownership verification
export function generateClaimToken(): string {
  // Use 24 bytes = 32 base64url chars
  const bytes = randomBytes(24);
  return bytes.toString('base64url');
}

// Hash a token using SHA-256 for secure storage
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Verify a token against its hash (constant-time comparison)
export function verifyTokenHash(token: string, hash: string): boolean {
  const tokenHash = hashToken(token);
  // Use timing-safe comparison to prevent timing attacks
  if (tokenHash.length !== hash.length) return false;
  let result = 0;
  for (let i = 0; i < tokenHash.length; i++) {
    result |= tokenHash.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return result === 0;
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

// ============================================================================
// WORLD GENERATION WITH NOISE-BASED BIOMES
// ============================================================================

/**
 * Generation parameters for world terrain
 * 
 * Note: Demo uses 100x100, ClawCity uses 500x500.
 * Scale parameters 5x to maintain same visual biome density.
 * Demo defaults: elevScale=50, moistScale=40
 * Scaled for 500x500: 50*5=250, 40*5=200
 */
const WORLD_GEN_CONFIG = {
  seed: 42,
  elevationScale: 250,  // Higher = larger terrain features (scaled 5x from demo)
  moistureScale: 200,   // Higher = larger moisture zones (scaled 5x from demo)
  detailScale: 500,     // Fine detail noise (scaled 5x from demo)
};

/**
 * Determine biome/terrain type based on elevation and moisture
 * This creates natural clustering of similar terrain types
 * 
 * Biome Matrix:
 * | Elevation / Moisture | Dry (0-0.3) | Medium (0.3-0.6) | Wet (0.6-1.0) |
 * |---------------------|-------------|------------------|---------------|
 * | High (0.7-1.0)      | Rocky Peaks | Mountain         | Mountain      |
 * | Medium-High (0.5-0.7)| Rocky Ground| Plains           | Forest        |
 * | Medium (0.3-0.5)    | Plains      | Plains           | Forest        |
 * | Low (0.15-0.3)      | Sand/Beach  | Plains           | Marsh         |
 * | Very Low (0-0.15)   | Water       | Water            | Deep Water    |
 */
function getBiomeTerrain(elevation: number, moisture: number): TerrainType {
  if (elevation < 0.15) {
    // Very low - water zones
    return moisture > 0.6 ? 'deep_water' : 'water';
  } else if (elevation < 0.3) {
    // Low elevation
    if (moisture < 0.3) return 'sand';
    if (moisture > 0.6) return 'marsh';
    return 'plains';
  } else if (elevation < 0.5) {
    // Medium elevation
    return moisture > 0.5 ? 'forest' : 'plains';
  } else if (elevation < 0.7) {
    // Medium-high elevation
    if (moisture < 0.3) return 'rocky';
    if (moisture > 0.6) return 'forest';
    return 'plains';
  } else {
    // High elevation
    return moisture < 0.3 ? 'rocky' : 'mountain';
  }
}

/**
 * Generate world tiles using noise-based biome system
 * Creates natural terrain clustering with smooth transitions
 */
export function generateWorldTiles(): Array<{ x: number; y: number; terrain: TerrainType; resources: Record<string, number> }> {
  const tiles: Array<{ x: number; y: number; terrain: TerrainType; resources: Record<string, number> }> = [];
  
  const { seed, elevationScale, moistureScale, detailScale } = WORLD_GEN_CONFIG;
  
  // Create noise generators with different seeds for each layer
  const elevNoise = new SimplexNoise(seed);
  const moistNoise = new SimplexNoise(seed + 1000);
  const detailNoise = new SimplexNoise(seed + 2000);

  // Market locations spread across the 500x500 world (25 markets in a 5x5 grid pattern)
  const marketLocations = new Set<string>();
  for (let mx = 0; mx < 5; mx++) {
    for (let my = 0; my < 5; my++) {
      const marketX = 50 + mx * 100; // Markets at 50, 150, 250, 350, 450
      const marketY = 50 + my * 100;
      marketLocations.add(`${marketX},${marketY}`);
    }
  }

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const key = `${x},${y}`;
      let terrain: TerrainType;

      // Check for market first
      if (marketLocations.has(key)) {
        terrain = 'market';
      }
      else {
        // Calculate noise coordinates
        const nx = x / elevationScale;
        const ny = y / elevationScale;
        const mx = x / moistureScale;
        const my = y / moistureScale;
        const dx = x / detailScale;
        const dy = y / detailScale;

        // Multi-octave elevation (fractal noise)
        // Combines large-scale features with fine detail
        let elevation = elevNoise.noise2D(nx, ny) * 0.6;
        elevation += elevNoise.noise2D(nx * 2, ny * 2) * 0.3;
        elevation += detailNoise.noise2D(dx * 4, dy * 4) * 0.1;
        elevation = (elevation + 1) / 2; // Normalize to 0-1

        // Multi-octave moisture
        let moisture = moistNoise.noise2D(mx, my) * 0.7;
        moisture += moistNoise.noise2D(mx * 2, my * 2) * 0.3;
        moisture = (moisture + 1) / 2; // Normalize to 0-1

        // Determine terrain from biome matrix
        terrain = getBiomeTerrain(elevation, moisture);
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
    case 'claim':
      return `${name} claimed a ${event.data.terrain || 'tile'} territory`;
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
    // New terrain types
    rocky: 'terrain-rocky',
    sand: 'terrain-sand',
    deep_water: 'terrain-deep-water',
    marsh: 'terrain-marsh',
  };
  return colors[terrain];
}

// Cooldown check result
export interface CooldownResult {
  allowed: boolean;
  remainingMs: number;
}

// Check if an action is allowed based on cooldown
export function checkCooldown(
  lastActionAt: string | null | undefined,
  cooldownMs: number
): CooldownResult {
  if (!lastActionAt) {
    return { allowed: true, remainingMs: 0 };
  }
  
  const lastAction = new Date(lastActionAt).getTime();
  const now = Date.now();
  const elapsed = now - lastAction;
  
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMs: 0 };
  }
  
  return { allowed: false, remainingMs: cooldownMs - elapsed };
}

// Get cooldown duration for a specific action type
export function getCooldownMs(actionType: 'move' | 'gather' | 'trade'): number {
  switch (actionType) {
    case 'move':
      return MOVE_COOLDOWN_MS;
    case 'gather':
      return GATHER_COOLDOWN_MS;
    case 'trade':
      return TRADE_COOLDOWN_MS;
  }
}
