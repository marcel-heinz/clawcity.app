import { getDepletionChance } from './types';

export type TileHealth =
  | 'non_depleting'
  | 'depleted'
  | 'fresh'
  | 'stable'
  | 'fragile'
  | 'critical';

export interface GatherCooldownMeta {
  cooldown_ms: number;
  cooldown_remaining_ms: number;
  next_gather_at: string;
}

export interface GatherTileIntel {
  model: 'depleting' | 'non_depleting';
  gather_count: number;
  tile_health: TileHealth;
  depletion_chance_percent: number;
  gathers_remaining_estimate: number | null;
}

function clampMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function buildGatherCooldownMeta(
  cooldownMs: number,
  remainingMs: number,
  nowMs: number = Date.now(),
): GatherCooldownMeta {
  const normalizedCooldown = clampMs(cooldownMs);
  const normalizedRemaining = Math.min(normalizedCooldown, clampMs(remainingMs));

  return {
    cooldown_ms: normalizedCooldown,
    cooldown_remaining_ms: normalizedRemaining,
    next_gather_at: new Date(nowMs + normalizedRemaining).toISOString(),
  };
}

export function classifyTileHealth(
  depletionChancePercent: number,
  opts: { depleted?: boolean; nonDepleting?: boolean } = {},
): TileHealth {
  if (opts.nonDepleting) return 'non_depleting';
  if (opts.depleted) return 'depleted';

  if (depletionChancePercent <= 0) return 'fresh';
  if (depletionChancePercent <= 18) return 'stable';
  if (depletionChancePercent <= 35) return 'fragile';
  return 'critical';
}

export function estimateGathersRemaining(currentGatherCount: number, maxSteps: number = 64): number {
  const baseCount = Math.max(0, Math.floor(currentGatherCount));
  let survivalProbability = 1;
  let expectedRemaining = 0;

  for (let step = 1; step <= maxSteps; step += 1) {
    expectedRemaining += survivalProbability;

    const depletionChance = getDepletionChance(baseCount + step);
    survivalProbability *= Math.max(0, 1 - depletionChance);

    if (survivalProbability < 0.001) {
      break;
    }
  }

  return Math.max(0, Math.round(expectedRemaining));
}

export function buildGatherTileIntel(
  gatherCount: number,
  opts: { depleted?: boolean; nonDepleting?: boolean } = {},
): GatherTileIntel {
  const normalizedCount = Math.max(0, Math.floor(gatherCount));

  if (opts.nonDepleting) {
    return {
      model: 'non_depleting',
      gather_count: normalizedCount,
      tile_health: 'non_depleting',
      depletion_chance_percent: 0,
      gathers_remaining_estimate: null,
    };
  }

  if (opts.depleted) {
    return {
      model: 'depleting',
      gather_count: normalizedCount,
      tile_health: 'depleted',
      depletion_chance_percent: 100,
      gathers_remaining_estimate: 0,
    };
  }

  const nextGatherChancePercent = Math.round(getDepletionChance(normalizedCount + 1) * 100);

  return {
    model: 'depleting',
    gather_count: normalizedCount,
    tile_health: classifyTileHealth(nextGatherChancePercent),
    depletion_chance_percent: nextGatherChancePercent,
    gathers_remaining_estimate: estimateGathersRemaining(normalizedCount),
  };
}
