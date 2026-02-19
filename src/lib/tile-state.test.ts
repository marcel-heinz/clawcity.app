import { describe, expect, it } from 'vitest';
import {
  getTileRegenerationTimestamp,
  hasTileRegenerated,
  isTileDepletedNow,
  isTileHarvestable,
} from './tile-state';

describe('tile depletion state helpers', () => {
  it('prefers regenerates_at over deprecated depleted_at', () => {
    const regenAt = '2026-02-19T20:00:00.000Z';
    const deprecated = '2026-02-19T10:00:00.000Z';

    expect(
      getTileRegenerationTimestamp({
        regenerates_at: regenAt,
        depleted_at: deprecated,
      })
    ).toBe(regenAt);
  });

  it('treats missing timestamps as regenerated', () => {
    expect(hasTileRegenerated(null, Date.now())).toBe(true);
    expect(hasTileRegenerated(undefined, Date.now())).toBe(true);
  });

  it('marks tile depleted until regeneration timestamp passes', () => {
    const now = Date.parse('2026-02-19T20:00:00.000Z');
    const future = '2026-02-19T20:05:00.000Z';
    const past = '2026-02-19T19:55:00.000Z';

    expect(isTileDepletedNow({ depleted: true, regenerates_at: future }, now)).toBe(true);
    expect(isTileHarvestable({ depleted: true, regenerates_at: future }, now)).toBe(false);
    expect(isTileDepletedNow({ depleted: true, regenerates_at: past }, now)).toBe(false);
    expect(isTileHarvestable({ depleted: true, regenerates_at: past }, now)).toBe(true);
  });

  it('keeps legacy tiles harvestable when not marked depleted', () => {
    const now = Date.parse('2026-02-19T20:00:00.000Z');
    expect(isTileDepletedNow({ depleted: false, depleted_at: null }, now)).toBe(false);
    expect(isTileHarvestable({ depleted: false, depleted_at: null }, now)).toBe(true);
  });
});
