import { describe, expect, it } from 'vitest';
import {
  buildBlockedGoalSet,
  buildTerrainTileStateMap,
  findNearestFreshTerrainTile,
  tileCoordKey,
} from './move-to-targeting';
import type { TerrainType } from './types';

function terrainFactory(grid: Record<string, TerrainType>, fallback: TerrainType = 'plains') {
  return (x: number, y: number): TerrainType => grid[`${x},${y}`] || fallback;
}

describe('move-to targeting helpers', () => {
  it('tracks blocked depleted coordinates', () => {
    const blocked = buildBlockedGoalSet([
      { x: 10, y: 10, depleted: true, regenerates_at: '2999-01-01T00:00:00.000Z' },
      { x: 11, y: 10, depleted: false, regenerates_at: null },
    ], Date.parse('2026-02-19T20:00:00.000Z'));

    expect(blocked.has(tileCoordKey(10, 10))).toBe(true);
    expect(blocked.has(tileCoordKey(11, 10))).toBe(false);
  });

  it('finds nearest fresh target tile while skipping known depleted tiles', () => {
    const terrainAt = terrainFactory({
      '5,5': 'forest',
      '5,4': 'forest',
      '5,6': 'forest',
      '6,5': 'forest',
    });
    const stateMap = buildTerrainTileStateMap([
      { x: 5, y: 4, depleted: true, regenerates_at: '2999-01-01T00:00:00.000Z' },
      { x: 5, y: 6, depleted: false, regenerates_at: null },
      { x: 6, y: 5, depleted: false, regenerates_at: null },
    ]);

    const target = findNearestFreshTerrainTile({
      startX: 5,
      startY: 5,
      targetTerrain: 'forest',
      maxSteps: 8,
      terrainAt,
      tileStateMap: stateMap,
      nowMs: Date.parse('2026-02-19T20:00:00.000Z'),
    });

    expect(target).not.toBeNull();
    expect(target?.distance).toBe(1);
    expect(`${target?.x},${target?.y}`).not.toBe('5,4');
  });

  it('returns null when no candidate exists in range', () => {
    const target = findNearestFreshTerrainTile({
      startX: 50,
      startY: 50,
      targetTerrain: 'water',
      maxSteps: 2,
      terrainAt: terrainFactory({}),
      tileStateMap: new Map(),
    });

    expect(target).toBeNull();
  });
});
