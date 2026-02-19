import { describe, expect, it } from 'vitest';
import {
  buildGatherCooldownMeta,
  buildGatherTileIntel,
  classifyTileHealth,
  estimateGathersRemaining,
} from './gather-intel';

describe('gather telemetry helpers', () => {
  it('builds cooldown metadata with deterministic next timestamp', () => {
    const fixedNow = Date.parse('2026-02-19T12:00:00.000Z');
    const cooldown = buildGatherCooldownMeta(5000, 3200, fixedNow);

    expect(cooldown.cooldown_ms).toBe(5000);
    expect(cooldown.cooldown_remaining_ms).toBe(3200);
    expect(cooldown.next_gather_at).toBe('2026-02-19T12:00:03.200Z');
  });

  it('classifies tile health bands from depletion chance', () => {
    expect(classifyTileHealth(0)).toBe('fresh');
    expect(classifyTileHealth(12)).toBe('stable');
    expect(classifyTileHealth(28)).toBe('fragile');
    expect(classifyTileHealth(48)).toBe('critical');
    expect(classifyTileHealth(22, { depleted: true })).toBe('depleted');
    expect(classifyTileHealth(22, { nonDepleting: true })).toBe('non_depleting');
  });

  it('estimates fewer remaining gathers as gather count rises', () => {
    const early = estimateGathersRemaining(0);
    const mid = estimateGathersRemaining(3);
    const late = estimateGathersRemaining(8);

    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(late);
    expect(late).toBeGreaterThanOrEqual(1);
  });

  it('builds depleting tile intel payload', () => {
    const intel = buildGatherTileIntel(2);

    expect(intel.model).toBe('depleting');
    expect(intel.gather_count).toBe(2);
    expect(intel.depletion_chance_percent).toBeGreaterThan(0);
    expect(intel.gathers_remaining_estimate).not.toBeNull();
  });

  it('builds depleted and non-depleting tile intel payloads', () => {
    const depleted = buildGatherTileIntel(4, { depleted: true });
    const staticTile = buildGatherTileIntel(9, { nonDepleting: true });

    expect(depleted.tile_health).toBe('depleted');
    expect(depleted.gathers_remaining_estimate).toBe(0);
    expect(staticTile.tile_health).toBe('non_depleting');
    expect(staticTile.gathers_remaining_estimate).toBeNull();
  });
});
