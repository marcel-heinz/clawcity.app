import { TerrainType } from './types';

// Tile size in pixels
export const TILE_SIZE = 16;
export const SCALE = 2; // Render at 2x for crisp pixels

// Tileset configuration
export const TILESET_CONFIG = {
  // Tileset image path
  path: '/sprites/tileset.png',
  
  // Tiles per row in the tileset image
  tilesPerRow: 8,
  
  // Tile size in the source image
  tileSize: TILE_SIZE,
};

// Terrain to tile index mapping
// Each terrain type can have multiple tile variants for visual variety
export const TERRAIN_TILES: Record<TerrainType, { normal: number[]; depleted: number[] }> = {
  plains: {
    normal: [0, 1, 2, 3],      // Grass variations
    depleted: [32, 33, 34, 35], // Dried/cracked grass
  },
  forest: {
    normal: [8, 9, 10, 11],    // Trees and bushes
    depleted: [40, 41, 42, 43], // Stumps and dead trees
  },
  mountain: {
    normal: [16, 17, 18, 19],  // Rocks and cliffs
    depleted: [48, 49, 50, 51], // Crumbled rocks
  },
  water: {
    normal: [24, 25, 26, 27],  // Water animation frames
    depleted: [56, 57, 58, 59], // Dried riverbed/puddles
  },
  market: {
    normal: [4, 5, 6, 7],      // Market building tiles
    depleted: [4, 5, 6, 7],    // Markets don't deplete visually
  },
};

// Agent sprite configuration
export const AGENT_SPRITE = {
  index: 64, // Starting index for agent sprites in tileset
  variants: 4, // Number of color variants
};

// Get tile index for a terrain type with optional variation
export function getTileIndex(
  terrain: TerrainType, 
  depleted: boolean = false,
  seed: number = 0
): number {
  const tiles = TERRAIN_TILES[terrain];
  const tileArray = depleted ? tiles.depleted : tiles.normal;
  
  // Use seed for consistent variation based on position
  const variantIndex = Math.abs(seed) % tileArray.length;
  return tileArray[variantIndex];
}

// Convert tile index to UV coordinates in tileset
export function getTileUV(tileIndex: number): { x: number; y: number } {
  const { tilesPerRow, tileSize } = TILESET_CONFIG;
  return {
    x: (tileIndex % tilesPerRow) * tileSize,
    y: Math.floor(tileIndex / tilesPerRow) * tileSize,
  };
}

// Color palette for the tileset (for programmatic generation)
export const PALETTE = {
  // Grass/Plains
  grass1: '#7ec850',
  grass2: '#5ea030',
  grass3: '#4a8020',
  grassDead: '#b8a060',
  
  // Forest
  treeTrunk: '#8b5a2b',
  treeLeaves: '#228b22',
  treeLeavesDark: '#1a6b1a',
  stump: '#6b4423',
  
  // Mountain
  rock1: '#808080',
  rock2: '#606060',
  rockLight: '#a0a0a0',
  rockCrumbled: '#505050',
  
  // Water
  water1: '#4a90d9',
  water2: '#3a7bc8',
  waterShallow: '#6ab0e9',
  waterDried: '#c4a882',
  
  // Market
  marketRoof: '#cc6633',
  marketWall: '#f5deb3',
  marketDoor: '#8b4513',
  
  // Agent
  agentBody: '#ff6b6b',
  agentOutline: '#333333',
  
  // Territory
  territoryBorder: '#ffd700',
  territoryOwned: 'rgba(255, 215, 0, 0.3)',
};

// Viewport configuration
export const VIEWPORT = {
  tilesWide: 20,
  tilesHigh: 15,
  get pixelWidth() {
    return this.tilesWide * TILE_SIZE * SCALE;
  },
  get pixelHeight() {
    return this.tilesHigh * TILE_SIZE * SCALE;
  },
};
