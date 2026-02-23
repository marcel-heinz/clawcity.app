import { TerrainType, WORLD_SIZE } from '@/lib/types';

export const WORLD_DESIGNER_TERRAINS: TerrainType[] = [
  'plains',
  'forest',
  'mountain',
  'market',
  'water',
  'rocky',
  'sand',
  'deep_water',
  'marsh',
];

export type WorldDesignerSymmetryMode = 'off' | 'mirror_x' | 'mirror_y' | 'quad';

export const WORLD_DESIGNER_TERRAIN_COLORS: Record<TerrainType, string> = {
  plains: '#90a955',
  forest: '#386641',
  mountain: '#6c757d',
  market: '#ffd700',
  water: '#4361ee',
  rocky: '#495057',
  sand: '#e9c46a',
  deep_water: '#1d3557',
  marsh: '#457b9d',
};

export const WORLD_TILE_COUNT = WORLD_SIZE * WORLD_SIZE;

const TERRAIN_TO_INDEX = new Map<TerrainType, number>(
  WORLD_DESIGNER_TERRAINS.map((terrain, index) => [terrain, index])
);

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function tileIndex(x: number, y: number): number {
  return y * WORLD_SIZE + x;
}

export function terrainToIndex(terrain: TerrainType): number {
  return TERRAIN_TO_INDEX.get(terrain) ?? 0;
}

export function indexToTerrain(index: number): TerrainType {
  return WORLD_DESIGNER_TERRAINS[clamp(Math.floor(index), 0, WORLD_DESIGNER_TERRAINS.length - 1)];
}

function hash2DInt(x: number, y: number, seed: number): number {
  let h = Math.imul(x + 1, 374761393);
  h ^= Math.imul(y + 1, 668265263);
  h ^= Math.imul(seed + 1, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 16;
  return h >>> 0;
}

function hash2DFloat(x: number, y: number, seed: number): number {
  return hash2DInt(x, y, seed) / 4294967295;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = smoothstep(fx - x0);
  const ty = smoothstep(fy - y0);

  const n00 = hash2DFloat(x0, y0, seed);
  const n10 = hash2DFloat(x1, y0, seed);
  const n01 = hash2DFloat(x0, y1, seed);
  const n11 = hash2DFloat(x1, y1, seed);

  const nx0 = lerp(n00, n10, tx);
  const nx1 = lerp(n01, n11, tx);
  return lerp(nx0, nx1, ty);
}

function getBiomeTerrainIndex(elevation: number, moisture: number): number {
  if (elevation < 0.15) {
    return moisture > 0.62 ? terrainToIndex('deep_water') : terrainToIndex('water');
  }
  if (elevation < 0.3) {
    if (moisture < 0.3) return terrainToIndex('sand');
    if (moisture > 0.63) return terrainToIndex('marsh');
    return terrainToIndex('plains');
  }
  if (elevation < 0.5) {
    return moisture > 0.54 ? terrainToIndex('forest') : terrainToIndex('plains');
  }
  if (elevation < 0.7) {
    if (moisture < 0.28) return terrainToIndex('rocky');
    if (moisture > 0.62) return terrainToIndex('forest');
    return terrainToIndex('plains');
  }
  return moisture < 0.33 ? terrainToIndex('rocky') : terrainToIndex('mountain');
}

function buildMarketSet(seed: number): Set<number> {
  const markets = new Set<number>();
  for (let gx = 0; gx < 5; gx++) {
    for (let gy = 0; gy < 5; gy++) {
      const rx = 10 + (hash2DInt(gx, gy, seed + 8881) % 80);
      const ry = 10 + (hash2DInt(gy, gx, seed + 9973) % 80);
      const x = clamp(gx * 100 + rx, 0, WORLD_SIZE - 1);
      const y = clamp(gy * 100 + ry, 0, WORLD_SIZE - 1);
      markets.add(tileIndex(x, y));
    }
  }
  return markets;
}

export function generateSeededWorld(seed: number): Uint8Array {
  const world = new Uint8Array(WORLD_TILE_COUNT);
  const marketTerrain = terrainToIndex('market');
  const markets = buildMarketSet(seed);

  for (let y = 0; y < WORLD_SIZE; y++) {
    for (let x = 0; x < WORLD_SIZE; x++) {
      const index = tileIndex(x, y);
      if (markets.has(index)) {
        world[index] = marketTerrain;
        continue;
      }

      const elevation =
        valueNoise(x, y, 180, seed + 11) * 0.58 +
        valueNoise(x, y, 90, seed + 29) * 0.29 +
        valueNoise(x, y, 45, seed + 53) * 0.13;

      const moisture =
        valueNoise(x, y, 210, seed + 109) * 0.6 +
        valueNoise(x, y, 105, seed + 157) * 0.27 +
        valueNoise(x, y, 52, seed + 211) * 0.13;

      world[index] = getBiomeTerrainIndex(elevation, moisture);
    }
  }

  return world;
}

export function computeTerrainCounts(world: Uint8Array): number[] {
  const counts = new Array<number>(WORLD_DESIGNER_TERRAINS.length).fill(0);
  for (let i = 0; i < world.length; i++) {
    counts[world[i]] += 1;
  }
  return counts;
}

export function getSymmetryPoints(
  x: number,
  y: number,
  mode: WorldDesignerSymmetryMode
): Array<{ x: number; y: number }> {
  if (mode === 'off') return [{ x, y }];

  const mirroredX = WORLD_SIZE - 1 - x;
  const mirroredY = WORLD_SIZE - 1 - y;
  const points: Array<{ x: number; y: number }> = [{ x, y }];

  if (mode === 'mirror_x' || mode === 'quad') points.push({ x: mirroredX, y });
  if (mode === 'mirror_y' || mode === 'quad') points.push({ x, y: mirroredY });
  if (mode === 'quad') points.push({ x: mirroredX, y: mirroredY });

  const unique = new Map<string, { x: number; y: number }>();
  for (const point of points) {
    unique.set(`${point.x},${point.y}`, point);
  }
  return Array.from(unique.values());
}

export function serializeWorldToBase64(world: Uint8Array): string {
  if (typeof window === 'undefined') {
    return Buffer.from(world).toString('base64');
  }

  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < world.length; i += CHUNK) {
    const part = world.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...part);
  }
  return window.btoa(binary);
}

export function deserializeWorldFromBase64(
  base64: string,
  expectedLength = WORLD_TILE_COUNT
): Uint8Array | null {
  try {
    const binary = typeof window === 'undefined'
      ? Buffer.from(base64, 'base64').toString('binary')
      : window.atob(base64);

    if (binary.length !== expectedLength) return null;

    const bytes = new Uint8Array(expectedLength);
    for (let i = 0; i < expectedLength; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export interface WorldDesignerTile {
  x: number;
  y: number;
  terrain: TerrainType;
}

export function extractTileWindow(
  world: Uint8Array,
  centerX: number,
  centerY: number,
  radius: number
): WorldDesignerTile[] {
  const tiles: WorldDesignerTile[] = [];
  const minX = clamp(centerX - radius, 0, WORLD_SIZE - 1);
  const maxX = clamp(centerX + radius, 0, WORLD_SIZE - 1);
  const minY = clamp(centerY - radius, 0, WORLD_SIZE - 1);
  const maxY = clamp(centerY + radius, 0, WORLD_SIZE - 1);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      tiles.push({
        x,
        y,
        terrain: indexToTerrain(world[tileIndex(x, y)]),
      });
    }
  }

  return tiles;
}
