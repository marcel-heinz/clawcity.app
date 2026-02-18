import { describe, expect, it } from 'vitest';
import {
  createTerrainResolver,
  DEFAULT_WORLD_GEN_CONFIG,
  generateWorldTilesRange,
  normalizeWorldGenConfig,
} from './game-logic';

describe('world generation', () => {
  it('is deterministic for identical config', () => {
    const config = normalizeWorldGenConfig({
      ...DEFAULT_WORLD_GEN_CONFIG,
      seed: 12345,
    });
    const resolverA = createTerrainResolver(config);
    const resolverB = createTerrainResolver(config);

    const samples: Array<[number, number]> = [
      [0, 0],
      [25, 25],
      [99, 201],
      [250, 250],
      [499, 499],
      [77, 388],
    ];

    const a = samples.map(([x, y]) => resolverA(x, y));
    const b = samples.map(([x, y]) => resolverB(x, y));
    expect(a).toEqual(b);
  });

  it('changes terrain output when seed changes', () => {
    const resolverA = createTerrainResolver({ ...DEFAULT_WORLD_GEN_CONFIG, seed: 42 });
    const resolverB = createTerrainResolver({ ...DEFAULT_WORLD_GEN_CONFIG, seed: 1337 });

    const samples: Array<[number, number]> = [
      [13, 13],
      [40, 240],
      [111, 111],
      [222, 222],
      [333, 333],
      [444, 123],
      [499, 10],
    ];

    const terrainA = samples.map(([x, y]) => resolverA(x, y));
    const terrainB = samples.map(([x, y]) => resolverB(x, y));

    const diffCount = terrainA.reduce(
      (count, terrain, idx) => count + (terrain !== terrainB[idx] ? 1 : 0),
      0
    );

    expect(diffCount).toBeGreaterThan(0);
  });

  it('range generation is chunk-order stable', () => {
    const config = { ...DEFAULT_WORLD_GEN_CONFIG, seed: 9876 };
    const whole = generateWorldTilesRange(0, 20, config);
    const chunked = [
      ...generateWorldTilesRange(0, 7, config),
      ...generateWorldTilesRange(7, 20, config),
    ];

    expect(chunked).toEqual(whole);
  });

  it('keeps market coordinates fixed across configs', () => {
    const resolver = createTerrainResolver({ ...DEFAULT_WORLD_GEN_CONFIG, seed: 424242 });
    const marketCoords: Array<[number, number]> = [];
    for (let mx = 0; mx < 5; mx++) {
      for (let my = 0; my < 5; my++) {
        marketCoords.push([50 + mx * 100, 50 + my * 100]);
      }
    }

    for (const [x, y] of marketCoords) {
      expect(resolver(x, y)).toBe('market');
    }
  });
});
