import { TerrainType, WORLD_SIZE } from './types';
import { isTileHarvestable, type TileDepletionState } from './tile-state';

export interface TerrainTileState extends TileDepletionState {
  x: number;
  y: number;
}

export interface HarvestableTerrainTarget {
  x: number;
  y: number;
  distance: number;
}

// Backwards-compatible alias for older imports.
export type FreshTerrainTarget = HarvestableTerrainTarget;

export function tileCoordKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function buildTerrainTileStateMap(tiles: TerrainTileState[]): Map<string, TerrainTileState> {
  const map = new Map<string, TerrainTileState>();
  for (const tile of tiles) {
    map.set(tileCoordKey(tile.x, tile.y), tile);
  }
  return map;
}

export function buildBlockedGoalSet(tiles: TerrainTileState[], nowMs = Date.now()): Set<string> {
  const blocked = new Set<string>();
  for (const tile of tiles) {
    if (!isTileHarvestable(tile, nowMs)) {
      blocked.add(tileCoordKey(tile.x, tile.y));
    }
  }
  return blocked;
}

export function findNearestHarvestableTerrainTile(params: {
  startX: number;
  startY: number;
  targetTerrain: TerrainType;
  maxSteps: number;
  terrainAt: (x: number, y: number) => TerrainType;
  tileStateMap: Map<string, TerrainTileState>;
  nowMs?: number;
}): HarvestableTerrainTarget | null {
  const {
    startX,
    startY,
    targetTerrain,
    maxSteps,
    terrainAt,
    tileStateMap,
    nowMs = Date.now(),
  } = params;

  for (let dist = 1; dist <= maxSteps; dist++) {
    for (let dx = -dist; dx <= dist; dx++) {
      const dyAbs = dist - Math.abs(dx);
      for (const dy of dyAbs === 0 ? [0] : [-dyAbs, dyAbs]) {
        const x = startX + dx;
        const y = startY + dy;
        if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
        if (terrainAt(x, y) !== targetTerrain) continue;

        const state = tileStateMap.get(tileCoordKey(x, y));
        if (state && !isTileHarvestable(state, nowMs)) continue;

        return { x, y, distance: dist };
      }
    }
  }

  return null;
}

// Backwards-compatible alias for callers still using "fresh" terminology.
export const findNearestFreshTerrainTile = findNearestHarvestableTerrainTile;
